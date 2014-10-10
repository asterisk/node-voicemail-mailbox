/**
 * Mailbox helpers module for Asterisk voicemail.
 *
 * @module mailbox-helpers
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var Q = require('q');

/**
 * Creates a function to update a mailboxe's MWI counts.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Client} client - ari client instance
 * @returns {Function} function - function to update the mailboxe's MWI counts
 */
function createMwiUpdater(mailbox, client) {
  return updateMwi;

  /**
   * Uses ari to update MWI for a given mailbox.
   *
   * @param {int} read - count of read messages
   * @param {int} unread - count of unread messages
   * @returns {Q} promise - a promise containing the result of updating the MWI
   *   counts through ARI
   */
  function updateMwi(read, unread) {
    var update = Q.denodeify(client.mailboxes.update.bind(client));

    return update({
      mailboxName: mailbox.mailboxName,
      oldMessages: read,
      newMessages: unread
    });
  }
}

module.exports = {
  createMwiUpdater: createMwiUpdater
};
