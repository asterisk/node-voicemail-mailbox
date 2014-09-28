/**
 * Mailbox module for Asterisk voicemail.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var reader = require('./reader.js');
var writer = require('./writer.js');

/**
 * Returns module functions.
 *
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} module - module functions
 */
module.exports = function(dependencies) {
  return {
    createReader: function(mailbox, channel) {
      return reader.create(mailbox, channel, dependencies);
    },

    createWriter: function(mailbox, channel) {
      return writer.create(mailbox, channel, dependencies);
    }
  };
};
