/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const testDriver = require('../../../tools/jil/index')

let supported = testDriver.Matcher.withFeature('workers')

const init = {
  jserrors: {
    enabled: false,
    harvestTimeSeconds: 5
  },
  metrics: {
    enabled: false
  }
}

timedPromiseAll = (promises, ms) => Promise.race([
  new Promise((resolve, reject) => {
    setTimeout(() => resolve(), ms)
  }),
  Promise.all(promises)
])

testDriver.test('classic - disabled jserrors should not generate errors', supported, function (t, browser, router) {
  let assetURL = router.assetURL('worker/classic-worker.html', {
    init,
    workerCommands: [
      () => newrelic.noticeError(new Error('test'))
    ].map(x => x.toString())
  })

  let loadPromise = browser.get(assetURL)
  let errPromise = router.expectErrors()

  timedPromiseAll([errPromise, loadPromise], 6000).then((response) => {
    if (response) { 
      // will be null if timed out, so a payload here means it sent and error
      t.fail(`Should not have generated "error" payload`)
    } else {
      // errors harvest every 5 seconds, if 6 seconds pass and Promise is not resolved, that means it was never generated
      t.pass(`Did not generate "error" payload`)
    }
    t.end()
  }).catch(fail)

  function fail(err) {
    t.error(err)
    t.end()
  }
})

testDriver.test('module - disabled jserrors should not generate errors', supported, function (t, browser, router) {
  let assetURL = router.assetURL('worker/module-worker.html', {
    init,
    workerCommands: [
      () => newrelic.noticeError(new Error('test'))
    ].map(x => x.toString())
  })

  let loadPromise = browser.get(assetURL)
  let errPromise = router.expectErrors()

  timedPromiseAll([errPromise, loadPromise], 6000).then((response) => {
    if (response) { 
      // will be null if timed out, so a payload here means it sent and error
      t.fail(`Should not have generated "error" payload`)
    } else {
      // errors harvest every 5 seconds, if 6 seconds pass and Promise is not resolved, that means it was never generated
      t.pass(`Did not generate "error" payload`)
    }
    t.end()
  }).catch(fail)

  function fail(err) {
    t.error(err)
    t.end()
  }
})