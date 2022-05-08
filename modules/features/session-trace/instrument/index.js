/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ee } from '../../../common/event-emitter/contextual-ee'
import { handle } from '../../../common/event-emitter/handle'
import { ee as timerEE } from '../../../common/wrap/wrap-timer'
import { ee as rafEE } from '../../../common/wrap/wrap-raf'
import '../../../common/wrap/wrap-history'
import '../../../common/wrap/wrap-events'
import { supportsPerformanceObserver } from '../../../common/window/supports-performance-observer'
import { eventListenerOpts } from '../../../common/event-listener/event-listener-opts'
import { originals, getRuntime } from '../../../common/config/config'
import { now } from '../../../common/timing/now'
import { log } from '../../../common/debug/logging'

// var ee = require('ee')
// var handle = require('handle')
// var timerEE = require('../../wrap-timer')
// var rafEE = require('../../wrap-raf')
// var supportsPerformanceObserver = require('supports-performance-observer')
// var eventListenerOpts = require('event-listener-opts')

var learResourceTimings = 'learResourceTimings'
var ADD_EVENT_LISTENER = 'addEventListener'
var REMOVE_EVENT_LISTENER = 'removeEventListener'
var RESOURCE_TIMING_BUFFER_FULL = 'resourcetimingbufferfull'
var BST_RESOURCE = 'bstResource'
var RESOURCE = 'resource'
var START = '-start'
var END = '-end'
var FN_START = 'fn' + START
var FN_END = 'fn' + END
var BST_TIMER = 'bstTimer'
var PUSH_STATE = 'pushState'

// // Turn on feature harvesting
// var loader = require('loader')
// if (loader.disabled) return

// loader.features.stn = true
getRuntime().features.stn = true

// wrap history ap
// require('../../wrap-history')

// wrap events
// if ('addEventListener' in window) {
//   require('../../wrap-events')
// }

// Cache the value of window.Event for later instanceof checks, in case someone
// overwrites it to be a non-function.
var origEvent = originals.EV

export function initialize() {
  if (!(window.performance &&
    window.performance.timing &&
    window.performance.getEntriesByType
  )) return

  log('INITIALIZE SESSION TRACE INSTRUMENTATION!')

  ee.on(FN_START, function (args, target) {
    var evt = args[0]
    if (evt instanceof origEvent) {
      this.bstStart = now()
    }
  })

  ee.on(FN_END, function (args, target) {
    var evt = args[0]
    if (evt instanceof origEvent) {
      handle('bst', [evt, target, this.bstStart, now()])
    }
  })

  timerEE.on(FN_START, function (args, obj, type) {
    this.bstStart = now()
    this.bstType = type
  })

  timerEE.on(FN_END, function (args, target) {
    handle(BST_TIMER, [target, this.bstStart, now(), this.bstType])
  })

  rafEE.on(FN_START, function () {
    this.bstStart = now()
  })

  rafEE.on(FN_END, function (args, target) {
    handle(BST_TIMER, [target, this.bstStart, now(), 'requestAnimationFrame'])
  })

  ee.on(PUSH_STATE + START, function (args) {
    this.time = now()
    this.startPath = location.pathname + location.hash
  })
  ee.on(PUSH_STATE + END, function (args) {
    handle('bstHist', [location.pathname + location.hash, this.startPath, this.time])
  })
}

function observeResourceTimings () {
  var observer = new PerformanceObserver(function (list, observer) { // eslint-disable-line no-undef
    var entries = list.getEntries()

    handle(BST_RESOURCE, [entries])
  })

  try {
    observer.observe({entryTypes: ['resource']})
  } catch (e) {
    // do nothing
  }
}

function onResourceTimingBufferFull (e) {
  handle(BST_RESOURCE, [window.performance.getEntriesByType(RESOURCE)])

  // stop recording once buffer is full
  if (window.performance['c' + learResourceTimings]) {
    try {
      window.performance[REMOVE_EVENT_LISTENER](RESOURCE_TIMING_BUFFER_FULL, onResourceTimingBufferFull, false)
    } catch (e) {
      // do nothing
    }
  } else {
    try {
      window.performance[REMOVE_EVENT_LISTENER]('webkit' + RESOURCE_TIMING_BUFFER_FULL, onResourceTimingBufferFull, false)
    } catch (e) {
      // do nothing
    }
  }
}

if (supportsPerformanceObserver()) {
  // capture initial resources, in case our observer missed anything
  handle(BST_RESOURCE, [window.performance.getEntriesByType('resource')])

  observeResourceTimings()
} else {
  // collect resource timings once when buffer is full
  if (ADD_EVENT_LISTENER in window.performance) {
    if (window.performance['c' + learResourceTimings]) {
      window.performance[ADD_EVENT_LISTENER](RESOURCE_TIMING_BUFFER_FULL, onResourceTimingBufferFull, eventListenerOpts(false))
    } else {
      window.performance[ADD_EVENT_LISTENER]('webkit' + RESOURCE_TIMING_BUFFER_FULL, onResourceTimingBufferFull, eventListenerOpts(false))
    }
  }
}

document[ADD_EVENT_LISTENER]('scroll', noOp, eventListenerOpts(false))
document[ADD_EVENT_LISTENER]('keypress', noOp, eventListenerOpts(false))
document[ADD_EVENT_LISTENER]('click', noOp, eventListenerOpts(false))

function noOp (e) { /* no-op */ }