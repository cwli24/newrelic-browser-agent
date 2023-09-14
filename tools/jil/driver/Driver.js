/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const path = require('path')
const { asserters } = require('wd')
const Matcher = require('../util/browser-matcher')
const AssetServer = require('../../testing-server/index')
const getCaller = require('../util/get-caller')
const loadBrowser = require('../loader/loadBrowser')
const Test = require('./Test')
const TestEnv = require('./TestEnv')
const TestRun = require('./TestRun')
const TestHarness = require('./harness')
const DeviceTest = require('./DeviceTest')
const { BrowserSpec } = require('../util/browser-list')
const { isSauceConnected } = require('../util/external-services')
const { v4: uuidV4 } = require('uuid')

class Driver {
  constructor (config, output) {
    this.tests = []
    this.failedTests = []
    this.testEnvs = []
    this.browserTestMatchers = {}

    let agentConfig = { licenseKey: 'asdf', applicationID: 42, accountID: 123, agentID: 456, trustKey: 789 }
    this.browserTests = []
    this.assetServer = new AssetServer(config, agentConfig, output)
    this.serverStartPromise = this.assetServer.start(config.port)
    this.router = this.assetServer.router
    this.timeout = config.timeout = config.timeout || 32000
    this.output = output
    this.concurrent = config.concurrent
    this.config = config
    this.asserters = asserters
  }

  ready (cb) {
    // Ensure the servers are up before starting the tests
    return this.serverStartPromise.then(() => {
      if (typeof cb === 'function') {
        cb()
      }
    })
  }

  addBrowser (connectionInfo, desired) {
    this.testEnvs.push(new TestEnv(connectionInfo, new BrowserSpec(desired)))
  }

  closeBrowser (ok, browser, done) {
    if (isSauceConnected()) {
      browser.sauceJobStatus(ok)
    }
    browser.quit(() => {
      done()
    }).catch((err) => {
      done(err)
    })
  }

  test (name, spec, test) {
    if (!test) {
      test = spec
      spec = null
    }

    this.tests.push(new Test(name, spec, test))
  }

  browserTest (name, spec, test) {
    if (!test) {
      test = spec
      spec = null
    }

    let testFile = getCaller()
    let relativePath = path.relative(process.cwd(), testFile)

    if (!this.browserTestMatchers[testFile]) {
      loadBrowser(this, testFile, relativePath, spec)
      this.browserTests.push(testFile)
      this.browserTestMatchers[testFile] = spec
    } else if (this.browserTestMatchers[testFile] !== spec) {
      throw new Error('all browser tests in ' + relativePath + ' must use the same matcher')
    }
  }

  generateID () {
    return uuidV4()
  }

  // runs tests based on an array of DeviceTest objects
  // used to run specific tests that failed during the main run

  /**
   * Runs tests on a specific browser session (represented by TestRun instance)
   *
   * @param {TestRun} testRun
   * @param {Array.<Test>}  tests
   * @param {bool}  isRetry
   *  When isRetry is false, failed tests will be stored for a later retry and not
   *  reported.
   * @param {function} cb
   */
  runTestRun (testRun, tests, isRetry, cb) {
    let driver = this
    this.output.log(`# starting tests for ${testRun.browserSpec.toString()}`)

    testRun.initialize(this.assetServer.urlFor('/'), (err) => {
      if (err) {
        process.exit(1)
      }

      let spec = testRun.browserSpec
      if (spec.version === 'latest' || spec.platformVersion === 'latest' || spec.version === 'beta') {
        this.output.log(`# ${spec.toString()} resolved to ${testRun.resolvedName}`)
      }

      driver.runTestsAgainstBrowser(testRun.browser, tests, isRetry, (err) => {
        cb(err, testRun)
      })
    })
  }

  runTestsAgainstBrowser (browser, testsToRun, isRetry, done) {
    let browserSpec = browser.browserSpec
    let router = this.router
    let currentTest = null

    let tests = testsToRun.filter((test) => {
      return !test.spec || test.spec.match(browserSpec)
    })

    if (tests.length === 0) {
      return process.nextTick(done)
    }

    let driver = this
    browser
      .then(queueTests)
      .catch(done)

    browser.match = (spec) => browserSpec.match(spec)
    browser.hasFeature = (feature) => browserSpec.hasFeature(feature)

    function queueTests () {
      var queued = 0
      var numberOfAttempts = 3

      if (!driver.config.retry) {
        numberOfAttempts = 1
      }

      let harness = new TestHarness()
      harness.stream.pipe(browser.stream)

      // used to notify Saucelabs on finish whether the overall test was successful
      var allOk = true

      for (let test of tests) {
        queueTest(test)
      }

      harness.run()

      function queueTest (test, attempt) {
        let name = test.name
        let fileName = test.fileName
        let fn = test.fn

        if (!attempt) {
          attempt = 1
        }

        let opts = {
          timeout: driver.config.tapeTimeout || 85000
        }
        queued++

        let testName = name
        if (attempt > 1) {
          testName += ` (retry ${attempt - 1})`
        }
        harness.addTest(testName, opts, (t) => {
          let startTime = Date.now()
          harness.pause()

          const id = driver.generateID()
          const handle = router.createTestHandle(id)
          let ended = false

          t.on('end', function () {
            router.destroyTestHandle(handle.testId)

            let plannedOk = !t._plan || t._plan <= t.assertCount
            let allAssertsOk = t._ok

            if (!allAssertsOk || !plannedOk) {
              if (attempt < numberOfAttempts) {
                harness.clear()
                queueTest(test, attempt + 1)
              } else if (!isRetry && driver.config.retry) {
                harness.clear()
                driver.output.log(`# storing failed test for later retry: ${browserSpec.toString()} - ${test.name}`)
                driver.failedTests.push(new DeviceTest(test, browserSpec))
              }
            }

            // if plan is less than expected, there will be one more result event
            // where we will resume stream instead
            if (plannedOk) {
              harness.resume()
            } else {
              t.once('result', handlePlanResult)
            }

            allOk = allOk && (t._ok || attempt < numberOfAttempts)
            currentTest = null
            ended = true

            queued--

            if (queued === 0) {
              process.nextTick(allDone)
            }
          })

          function handlePlanResult () {
            if (ended && t.error) {
              if (attempt < numberOfAttempts || (!isRetry && driver.config.retry)) {
                harness.clear()
              }
              harness.resume()
            }
          }

          currentTest = t
          try {
            fn(t, browser, handle)
          } catch (e) {
            t.error(e)
            t.end()
          }
        })
      }

      function allDone () {
        driver.output.log('# tearing down ' + browserSpec)
        driver.closeBrowser(allOk, browser, (err) => {
          driver.output.log('# closed ' + browserSpec)
          done(err)
        })
      }
    }

    browser.catch((err) => {
      if (currentTest) currentTest.fail(err)
      driver.output.log('# closing due to error ' + browserSpec)
      this.closeBrowser(false, browser, () => {
        driver.output.log('# closed due to error ' + browserSpec)
        done(err)
      })
    })
  }

  /**
   * Runs tests based on an array of DeviceTest objects - used to run specific tests that
   * failed during the main run.
   *
   * @param {Array.<DeviceTest>}  tests
   * @param {function} cb
   */
  runDeviceTests (tests, cb) {
    let driver = this
    // find unique Browsers
    let testEnvs = findUniqueTestEnvs(tests)

    var running = new Set()
    for (let testEnv of testEnvs) {
      let browserSpec = testEnv.browserSpec
      let testRun = new TestRun(testEnv, this)
      this.output.addChild(browserSpec.toString(), testRun.stream)

      let testsToRun = findTests(tests, browserSpec)
      driver.output.log(`# retrying ${testsToRun.length} tests for ${browserSpec.toString()}`)
      this.ready(() => {
        this.runTestRun(testRun, testsToRun, true, onBrowserFinished)
      })
      running.add(testRun)
    }

    function onBrowserFinished (err, testRun) {
      if (err) {
        driver.output.log(`# got error while running tests (${testRun.browserSpec.toString()})`)
      }

      running.delete(testRun)
      driver.output.log(`# closed a browser, ${running.size} remaining`)

      if (running.size === 0) {
        cb(err)
      }
    }

    function findUniqueTestEnvs (tests) {
      return tests.map((test) => {
        return test.browserSpec
      })
        .reduce((reduced, spec) => {
          let found = false
          reduced.forEach((s) => {
            if (s.same(spec)) {
              found = true
            }
          })
          if (!found) {
            reduced.push(spec)
          }
          return reduced
        }, [])
        .map((browserSpec) => {
          return driver.testEnvs.find((testEnv) => {
            return testEnv.browserSpec.same(browserSpec)
          })
        })
    }

    function findTests (tests, browserSpec) {
      return tests.filter((test) => {
        return test.browserSpec.same(browserSpec)
      })
        .map((deviceTest) => {
          return deviceTest.test
        })
    }
  }
}

Driver.prototype.Matcher = Matcher

module.exports = Driver
