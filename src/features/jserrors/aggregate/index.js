/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { canonicalFunctionName } from './canonical-function-name'
import { computeStackTrace } from './compute-stack-trace'
import { stringHashCode } from './string-hash-code'
import { truncateSize } from './format-stack-trace'

import { registerHandler as register } from '../../../common/event-emitter/register-handler'
import { HarvestScheduler } from '../../../common/harvest/harvest-scheduler'
import { stringify } from '../../../common/util/stringify'
import { handle } from '../../../common/event-emitter/handle'
import { mapOwn } from '../../../common/util/map-own'
import { getInfo, getConfigurationValue, getRuntime } from '../../../common/config/config'
import { now } from '../../../common/timing/now'
import { globalScope } from '../../../common/constants/runtime'

import { FEATURE_NAME } from '../constants'
import { FEATURE_NAMES } from '../../../loaders/features/features'
import { AggregateBase } from '../../utils/aggregate-base'
import { getNREUMInitializedAgent } from '../../../common/window/nreum'

/**
 * @typedef {import('./compute-stack-trace.js').StackInfo} StackInfo
 */

export class Aggregate extends AggregateBase {
  static featureName = FEATURE_NAME
  constructor (agentIdentifier, aggregator) {
    super(agentIdentifier, aggregator, FEATURE_NAME)

    this.stackReported = {}
    this.observedAt = {}
    this.pageviewReported = {}
    this.bufferedErrorsUnderSpa = {}
    this.currentBody = undefined
    this.errorOnPage = false

    // this will need to change to match whatever ee we use in the instrument
    this.ee.on('interactionDone', (interaction, wasSaved) => this.onInteractionDone(interaction, wasSaved))

    register('err', (...args) => this.storeError(...args), this.featureName, this.ee)
    register('ierr', (...args) => this.storeError(...args), this.featureName, this.ee)
    register('softNavFlush', (interactionId, wasFinished, softNavAttrs) =>
      this.onSoftNavNotification(interactionId, wasFinished, softNavAttrs), this.featureName, this.ee) // when an ixn is done or cancelled

    const harvestTimeSeconds = getConfigurationValue(this.agentIdentifier, 'jserrors.harvestTimeSeconds') || 10

    const scheduler = new HarvestScheduler('jserrors', { onFinished: (...args) => this.onHarvestFinished(...args) }, this)
    scheduler.harvest.on('jserrors', (...args) => this.onHarvestStarted(...args))

    // Don't start harvesting until "drain" for this feat has been called (which currently requires RUM response).
    this.ee.on(`drain-${this.featureName}`, () => {
      if (!this.blocked) scheduler.startTimer(harvestTimeSeconds) // and only if ingest will accept jserror payloads
    })

    // If RUM-call's response determines that customer lacks entitlements for the /jserror ingest endpoint, don't harvest at all.
    register('block-err', () => {
      this.blocked = true
      scheduler.stopTimer(true)
    }, this.featureName, this.ee)

    this.drain()
  }

  onHarvestStarted (options) {
    // this gets rid of dependency in AJAX module
    var body = this.aggregator.take(['err', 'ierr', 'xhr'])

    if (options.retry) {
      this.currentBody = body
    }

    var payload = { body, qs: {} }
    var releaseIds = stringify(getRuntime(this.agentIdentifier).releaseIds)

    if (releaseIds !== '{}') {
      payload.qs.ri = releaseIds
    }

    if (body && body.err && body.err.length && !this.errorOnPage) {
      payload.qs.pve = '1'
      this.errorOnPage = true
    }
    return payload
  }

  onHarvestFinished (result) {
    if (result.retry && this.currentBody) {
      mapOwn(this.currentBody, (key, value) => {
        for (var i = 0; i < value.length; i++) {
          var bucket = value[i]
          var name = this.getBucketName(key, bucket.params, bucket.custom)
          this.aggregator.merge(key, name, bucket.metrics, bucket.params, bucket.custom)
        }
      })
      this.currentBody = null
    }
  }

  nameHash (params) {
    return stringHashCode(`${params.exceptionClass}_${params.message}_${params.stack_trace || params.browser_stack_hash}`)
  }

  getBucketName (objType, params, customParams) {
    if (objType === 'xhr') {
      return stringHashCode(stringify(params)) + ':' + stringHashCode(stringify(customParams))
    }

    return this.nameHash(params) + ':' + stringHashCode(stringify(customParams))
  }

  /**
   * Builds a standardized stack trace string from the frames in the given `stackInfo` object, with each frame separated
   * by a newline character. Lines take the form `<functionName>@<url>:<lineNumber>`.
   *
   * @param {StackInfo} stackInfo - An object specifying a stack string and individual frames.
   * @returns {string} A canonical stack string built from the URLs and function names in the given `stackInfo` object.
   */
  buildCanonicalStackString (stackInfo) {
    var canonicalStackString = ''

    for (var i = 0; i < stackInfo.frames.length; i++) {
      var frame = stackInfo.frames[i]
      var func = canonicalFunctionName(frame.func)

      if (canonicalStackString) canonicalStackString += '\n'
      if (func) canonicalStackString += func + '@'
      if (typeof frame.url === 'string') canonicalStackString += frame.url
      if (frame.line) canonicalStackString += ':' + frame.line
    }

    return canonicalStackString
  }

  storeError (err, time, internal, customAttributes) {
    // are we in an interaction
    time = time || now()
    const agentRuntime = getRuntime(this.agentIdentifier)
    let filterOutput

    if (!internal && agentRuntime.onerror) {
      filterOutput = agentRuntime.onerror(err)
      if (filterOutput && !(typeof filterOutput.group === 'string' && filterOutput.group.length)) {
        // All truthy values mean don't report (store) the error, per backwards-compatible usage,
        // - EXCEPT if a fingerprinting label is returned, via an object with key of 'group' and value of non-empty string
        return
      }
      // Again as with previous usage, all falsey values would include the error.
    }

    var stackInfo = computeStackTrace(err)
    var canonicalStackString = this.buildCanonicalStackString(stackInfo)

    const params = {
      stackHash: stringHashCode(canonicalStackString),
      exceptionClass: stackInfo.name,
      request_uri: globalScope?.location.pathname
    }
    if (stackInfo.message) params.message = '' + stackInfo.message
    // Notice if filterOutput isn't false|undefined OR our specified object, this func would've returned already (so it's unnecessary to req-check group).
    // Do not modify the name ('errorGroup') of params without DEM approval!
    if (filterOutput?.group) params.errorGroup = filterOutput.group

    /**
     * The bucketHash is different from the params.stackHash because the params.stackHash is based on the canonicalized
     * stack trace and is used downstream in NR1 to attempt to group the same errors across different browsers. However,
     * the canonical stack trace excludes items like the column number increasing the hit-rate of different errors potentially
     * bucketing and ultimately resulting in the loss of data in NR1.
     */
    var bucketHash = stringHashCode(`${stackInfo.name}_${stackInfo.message}_${stackInfo.stackString}`)

    if (!this.stackReported[bucketHash]) {
      this.stackReported[bucketHash] = true
      params.stack_trace = truncateSize(stackInfo.stackString)
      this.observedAt[bucketHash] = agentRuntime.offset + time
    } else {
      params.browser_stack_hash = stringHashCode(stackInfo.stackString)
    }
    params.releaseIds = stringify(agentRuntime.releaseIds)

    // When debugging stack canonicalization/hashing, uncomment these lines for
    // more output in the test logs
    // params.origStack = err.stack
    // params.canonicalStack = canonicalStack

    if (!this.pageviewReported[bucketHash]) {
      params.pageview = 1
      this.pageviewReported[bucketHash] = true
    }

    if (agentRuntime?.session?.state?.sessionReplayMode) params.hasReplay = true
    params.firstOccurrenceTimestamp = this.observedAt[bucketHash]

    var type = internal ? 'ierr' : 'err'
    var newMetrics = { time }

    // Trace sends the error in its payload, and both trace & replay simply listens for any error to occur.
    const jsErrorEvent = [type, bucketHash, params, newMetrics, customAttributes]
    handle('errorAgg', jsErrorEvent, undefined, FEATURE_NAMES.sessionTrace, this.ee)
    handle('errorAgg', jsErrorEvent, undefined, FEATURE_NAMES.sessionReplay, this.ee)
    // still send EE events for other features such as above, but stop this one from aggregating internal data
    if (this.blocked) return

    const softNavInUse = Boolean(getNREUMInitializedAgent(this.agentIdentifier)?.features[FEATURE_NAMES.softNav])
    // Note: the following are subject to potential race cond wherein if the other feature aren't fully initialized, it'll be treated as there being no associated interaction.
    // They each will also tack on their respective properties to the params object as part of the decision flow.
    if (softNavInUse) handle('jserror', [params, time], undefined, FEATURE_NAMES.softNav, this.ee)
    else handle('errorAgg', jsErrorEvent, undefined, FEATURE_NAMES.spa, this.ee)

    if (params.browserInteractionId && !params._softNavFinished) { // hold onto the error until the in-progress interaction is done, eithered saved or discarded
      this.bufferedErrorsUnderSpa[params.browserInteractionId] ??= []
      this.bufferedErrorsUnderSpa[params.browserInteractionId].push(jsErrorEvent)
    } else if (params._interactionId != null) { // same as above, except tailored for the way old spa does it
      this.bufferedErrorsUnderSpa[params._interactionId] = this.bufferedErrorsUnderSpa[params._interactionId] || []
      this.bufferedErrorsUnderSpa[params._interactionId].push(jsErrorEvent)
    } else {
      // Either there is no interaction (then all these params properties will be undefined) OR there's a related soft navigation that's already completed.
      // The old spa does not look up completed interactions at all, so there's no need to consider it.
      this.#storeJserrorForHarvest(jsErrorEvent, params.browserInteractionId !== undefined, params._softNavAttributes)
    }
  }

  #storeJserrorForHarvest (errorInfoArr, softNavOccurredFinished, softNavCustomAttrs = {}) {
    let [type, bucketHash, params, newMetrics, localAttrs] = errorInfoArr
    const allCustomAttrs = {}

    if (softNavOccurredFinished) {
      Object.entries(softNavCustomAttrs).forEach(([k, v]) => setCustom(k, v)) // when an ixn finishes, it'll include stuff in jsAttributes + attrs specific to the ixn
      bucketHash += params.browserInteractionId

      delete params._softNavAttributes // cleanup temp properties from synchronous evaluation; this is harmless when async from soft nav (properties DNE)
      delete params._softNavFinished
    } else { // interaction was cancelled -> error should not be associated OR there was no interaction
      Object.entries(getInfo(this.agentIdentifier).jsAttributes).forEach(([k, v]) => setCustom(k, v))
      delete params.browserInteractionId
    }
    if (localAttrs) Object.entries(localAttrs).forEach(([k, v]) => setCustom(k, v)) // local custom attrs are applied in either case with the highest precedence

    const jsAttributesHash = stringHashCode(stringify(allCustomAttrs))
    const aggregateHash = bucketHash + ':' + jsAttributesHash
    this.aggregator.store(type, aggregateHash, params, newMetrics, allCustomAttrs)

    function setCustom (key, val) {
      allCustomAttrs[key] = (val && typeof val === 'object' ? stringify(val) : val)
    }
  }

  // TO-DO: Remove this function when old spa is taken out. #storeJserrorForHarvest handles the work with the softnav feature.
  onInteractionDone (interaction, wasSaved) {
    if (!this.bufferedErrorsUnderSpa[interaction.id] || this.blocked) return

    this.bufferedErrorsUnderSpa[interaction.id].forEach((item) => {
      var allCustomAttrs = {}
      const localCustomAttrs = item[4]

      mapOwn(interaction.root.attrs.custom, setCustom) // tack on custom attrs from the interaction
      mapOwn(localCustomAttrs, setCustom)

      var params = item[2]
      if (wasSaved) {
        params.browserInteractionId = interaction.root.attrs.id
        if (params._interactionNodeId) params.parentNodeId = params._interactionNodeId.toString()
      }
      delete params._interactionId
      delete params._interactionNodeId

      var hash = wasSaved ? item[1] + interaction.root.attrs.id : item[1]
      var jsAttributesHash = stringHashCode(stringify(allCustomAttrs))
      var aggregateHash = hash + ':' + jsAttributesHash

      this.aggregator.store(item[0], aggregateHash, params, item[3], allCustomAttrs)

      function setCustom (key, val) {
        allCustomAttrs[key] = (val && typeof val === 'object' ? stringify(val) : val)
      }
    })
    delete this.bufferedErrorsUnderSpa[interaction.id]
  }

  onSoftNavNotification (interactionId, wasFinished, softNavAttrs) {
    if (this.blocked) return

    this.bufferedErrorsUnderSpa[interactionId]?.forEach(jsErrorEvent =>
      this.#storeJserrorForHarvest(jsErrorEvent, wasFinished, softNavAttrs) // this should not modify the re-used softNavAttrs contents
    )
    delete this.bufferedErrorsUnderSpa[interactionId] // wipe the list of jserrors so they aren't duplicated by another call to the same id
  }
}
