/**
 * @file Contains common methods used to transmit harvested data.
 * @copyright 2023 New Relic Corporation. All rights reserved.
 * @license Apache-2.0
 */

import { isBrowserScope, supportsSendBeacon } from '../constants/runtime'

/**
 * @typedef {xhr|fetchKeepAlive|beacon} NetworkMethods
 */

/**
 * Determines the submit method to use based on options.
 * @param {object} opts Options used to determine submit method.
 * @param {boolean} opts.isFinalHarvest Indicates if the data submission is due to
 * a final harvest within the agent.
 */
export function getSubmitMethod ({ isFinalHarvest = false } = {}) {
  return isFinalHarvest && isBrowserScope && supportsSendBeacon
    // Use sendBeacon for final harvest
    ? beacon
    // Only IE does not support sendBeacon for final harvest
    // If not final harvest, or not browserScope, always use xhr post
    : xhr
}

/**
 * Send via XHR
 * @param {Object} args - The args.
 * @param {string} args.url - The URL to send to.
 * @param {string=} args.body - The Stringified body. Default null to prevent IE11 from breaking.
 * @param {boolean=} args.sync - Run XHR synchronously.
 * @param {string=} [args.method=POST] - The XHR method to use.
 * @param {{key: string, value: string}[]} [args.headers] - The headers to attach.
 * @returns {XMLHttpRequest}
 */
export function xhr ({ url, body = null, sync, method = 'POST', headers = [{ key: 'content-type', value: 'text/plain' }] }) {
  const request = new XMLHttpRequest()

  request.open(method, url, !sync)
  try {
    // Set cookie
    if ('withCredentials' in request) request.withCredentials = true
  } catch (e) {
    // do nothing
  }

  headers.forEach(header => {
    request.setRequestHeader(header.key, header.value)
  })

  request.send(body)
  return request
}

/**
 * Send via fetch with keepalive true
 * @param {Object} args - The args.
 * @param {string} args.url - The URL to send to.
 * @param {string=} args.body - The Stringified body.
 * @param {string=} [args.method=POST] - The XHR method to use.
 * @param {{key: string, value: string}[]} [args.headers] - The headers to attach.
 * @returns {XMLHttpRequest}
 */
export function fetchKeepAlive ({ url, body = null, method = 'POST', headers = [{ key: 'content-type', value: 'text/plain' }] }) {
  return fetch(url, {
    method,
    headers: headers.reduce((aggregator, header) => {
      aggregator.push([header.key, header.value])
      return aggregator
    }, []),
    body,
    keepalive: true
  })
}

/**
 * Send via sendBeacon. Do NOT call this function outside of a guaranteed web window environment.
 * @param {Object} args - The args
 * @param {string} args.url - The URL to send to
 * @param {string=} args.body - The Stringified body
 * @returns {boolean}
 */
export function beacon ({ url, body }) {
  try {
    // Navigator has to be bound to ensure it does not error in some browsers
    // https://xgwang.me/posts/you-may-not-know-beacon/#it-may-throw-error%2C-be-sure-to-catch
    const send = window.navigator.sendBeacon.bind(window.navigator)
    return send(url, body)
  } catch (err) {
    // if sendBeacon still trys to throw an illegal invocation error,
    // we can catch here and return.  The harvest module will fallback to use
    // fetchKeepAlive to try to send
    return false
  }
}
