/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const submitData = {}

/**
 * Do NOT call this function outside of a guaranteed web window environment.
 */
submitData.jsonp = function jsonp (url, jsonp) {
  var element = document.createElement('script')
  element.type = 'text/javascript'
  element.src = url + '&jsonp=' + jsonp
  var firstScript = document.getElementsByTagName('script')[0]
  firstScript.parentNode.insertBefore(element, firstScript)
  return element
}

submitData.xhr = function xhr (url, body, sync) {
  var request = new XMLHttpRequest()

  request.open('POST', url, !sync)
  try {
    // Set cookie
    if ('withCredentials' in request) request.withCredentials = true
  } catch (e) {
    // do nothing
  }

  request.setRequestHeader('content-type', 'text/plain')
  request.send(body)
  return request
}

/**
 * Unused at the moment -- DEPRECATED
 */
// submitData.xhrSync = function xhrSync (url, body) {
//   return submitData.xhr(url, body, true)
// }

/**
 * Do NOT call this function outside of a guaranteed web window environment.
 */
submitData.img = function img (url) {
  var element = new Image()
  element.src = url
  return element
}

/**
 * Do NOT call this function outside of a guaranteed web window environment.
 */
submitData.beacon = function (url, body) {
  return window.navigator.sendBeacon(url, body)
}