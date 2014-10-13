/**
 * Messages helper for interacting with folder messages.
 *
 * @module messages
 *
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var moment = require('moment');

/**
 * Returns an object representing a collection of messages.
 */
function collection() {
  var messages = [];
  // current index into messages
  var currentIndex = 0;
  // we may not have started playing messages or message could have been removed
  var currentMessage = false;
  var getMessage = function() {
    return messages[currentIndex];
  };

  var collectionObj = {
    // 1900
    latest: moment.utc('1990-01-01T00:00:00.000Z'),

    previousExists: function() {
      return currentIndex > 0;
    },

    currentExists: function() {
      return currentMessage;
    },

    isEmpty: function() {
      return !!messages.length;
    },

    isNotEmpty: function() {
      return !this.isEmpty();
    },

    many: function() {
      return messages.length > 1;
    },
  
    first: function() {
      currentIndex = 0;
      currentMessage = true;

      return getMessage();
    },

    next: function() {
      currentIndex = currentMessage ? currentIndex + 1: currentIndex;
      currentMessage = true;
      var message = getMessage();

      if (currentIndex === messages.length) {
        currentIndex -= 1;
      }

      return message;
    },

    current: function() {
      currentMessage = true;

      return getMessage();
    },

    previous: function() {
      currentIndex -= 1;
      var message = getMessage();

      if (currentIndex < 0) {
        currentIndex = 0;
      }

      return message;
    },

    getOrder: function() {
      return currentIndex + 1;
    },

    add: function(newMessages) {
      var self = this;
      var reinsert = false;
      if (!Array.isArray(newMessages)) {
        newMessages = [newMessages];
      }
      if (messages.length) {
        reinsert = true;
      }

      newMessages.forEach(function (message) {
        // skip duplicates
        var existing = messages.filter(function(candidate) {
          return candidate.getId() === message.getId() && message.getId();
        });

        if (!existing.length) {
          messages.push(message);

          if (message.date.isAfter(self.latest)) {
            self.latest = message.date;
          }
        }
      });

      if (reinsert) {
        this.sort();
      }
    },

    sort: function() {
      var unread = split(messages, false);
      var read = split(messages, true);
      // add all unread to the list of read to recombine into final array
      messages = sortByDate(unread).concat(sortByDate(read));

      function split(array, read) {
        return array.filter(function(message) {
          return (read && message.read) || (!read && !message.read);
        });
      }

      function sortByDate(array) {
        var clone = [].concat(array); 

        clone.sort(function(first, second) {
          // sort in ascending order
          if (first.date.isAfter(second.date)) {
            return 1;
          } else if (second.date.isAfter(first.date)) {
            return -1;
          } else {
            return 0;
          }
        });

        return clone;
      }
    },

    remove: function(message) {
      // no need to update latest since we use that value to fetch another batch
      // of messages
      messages = messages.filter(function(candidate) {
        return candidate.getId() !== message.getId();
      });

      currentMessage = false;
    },

    calculateMenu: function() {
      var menu = [];

      if (currentIndex === 0 && !currentMessage) {
        menu.push('menuFirst');
      }

      if (this.previousExists()) {
        menu.push('menuPrev');
      }

      if (currentMessage) {
        menu.push('menuRepeat');
      }

      if (currentIndex !== messages.length - 1) {
        menu.push('menuNext');
      }

      if (currentMessage) {
        menu.push('menuDelete');
      }

      return menu;
    }
  };

  return collectionObj;
}

/**
 * Returns a messages collection from an array of latest messages.
 *
 * @param {Message[]} latestMessages - latest messages
 * @returns {Messages} messages - a messages collection object for interacting
 *   with a mailboxe's messages
 */
function populateFromMessages(latestMessages) {
  var messages = collection();
  messages.add(latestMessages);

  return messages;
}

/**
 * Returns module functions.
 *
 * @returns {object} module - module functions
 */
module.exports = {
  create: populateFromMessages
};
