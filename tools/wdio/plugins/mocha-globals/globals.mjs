import '../../../jest/matchers.mjs'

/**
 * This file is executed by mocha in each WDIO execution thread.
 */

beforeEach(async () => {
  const testHandle = await browser.getTestHandle()
  browser.testHandle = testHandle
})

afterEach(async () => {
  await browser.collectCoverage()

  if (browser.testHandle) {
    browser.testHandle.destroy()
  }
})
