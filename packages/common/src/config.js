/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var runtimeConfiguration = {
  origin: '' + window.location
}

var info = {}
var init = {}

module.exports = {
  setConfiguration: setConfiguration,
  getConfiguration: getConfiguration,
  getConfigurationValue: getConfigurationValue,
  setConfigurationValue: setConfigurationValue,
  getInfo: getInfo,
  setInfo: setInfo,
  runtime: runtimeConfiguration
}

function getConfiguration() {
  return init
}

function setConfiguration(configuration) {
  init = configuration
}

function getConfigurationValue(path) {
  var val = init
  var parts = path.split('.')
  for (var i = 0; i < parts.length - 1; i++) {
    val = val[parts[i]]
    if (typeof val !== 'object') return
  }
  val = val[parts[parts.length - 1]]
  return val
}

function setConfigurationValue(path, newValue) {
  var val = init
  var parts = path.split('.')
  for (var i = 0; i < parts.length - 1; i++) {
    if (typeof val[parts[i]] === 'undefined') {
      val[parts[i]] = {}
    }
    val = val[parts[i]]
  }
  val[parts[parts.length - 1]] = newValue
}

function getInfo() {
  // if (window.NREUM && window.NREUM.info) {
  //   return window.NREUM.info
  // }
  // return {}
  return info
}

function setInfo(obj) {
  // no longer global
  // window.NREUM = window.NREUM || {}
  // window.NREUM.info = info = window.NREUM.info || {}

  if (obj.licenseKey) {
    info.licenseKey = obj.licenseKey
  }

  if (obj.beaconUrl) {
    info.beacon = obj.beaconUrl
    info.errorBeacon = obj.beaconUrl
  }

  if (obj.beacon) {
    info.beacon = obj.beacon
  }

  if (obj.errorBeacon) {
    info.errorBeacon = obj.errorBeacon
  }

  if (obj.appId) {
    info.applicationID = obj.appId
  }

  if (obj.applicationID) {
    info.applicationID = obj.applicationID
  }

  // TODO: there are others
}
