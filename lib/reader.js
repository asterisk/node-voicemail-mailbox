/**
 * Mailbox Reader module for Asterisk voicemail.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var Q = require('q');
var ari = require('ari-client-wrapper');
var machina = require('machina');
var util = require('util');

/**
 * Returns a new finite state machine instance for the given channel and
 * helpers intended to be used to listen to messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {machina.Fsm} fsm - a finite state machine instance
 */
function fsm(mailbox, channel, dependencies) {
  var fsmInstance = new machina.Fsm({

    initialState: 'init',

    states : {
      // bootstrapping
      'init' : {
      },

      // done reading mailbox
      'done': {
        _onEnter: function() {
          // cleanup
        },

        '*': function() {
          console.error('called handle on spent fsm instance.');
        }
      }
    }
  });

  return fsmInstance;
}

/**
 * Returns a mailbox reader object that can be used to listen to messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} api - api for reading mailbox messages
 */
function create(mailbox, channel, dependencies) {
  var state = fsm(mailbox, channel, dependencies);

  var api = {
  };

  if (true) {
    throw new Error('This has not been implemented yet');
  }

  return api;
}

/**
 * Returns module functions.
 *
 * @returns {object} module - module functions
 */
module.exports = {
  create: create
};
