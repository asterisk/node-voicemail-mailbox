/**
 * Mailbox Writer module unit tests.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global it:false*/

var mockery = require('mockery');
var Q = require('q');
var assert = require('assert');
var util = require('util');
var path = require('path');
var Emitter = require('events').EventEmitter;

var mockClient;
// used to test whether or not recording finished
var recordingFinished = false;
// used to test whether or not the prompt finished
var promptFinished = false;
// used to test whether or not the prompt was stopped
var promptStopped = false;
// used to test message being saved
var message = null;
// milliseconds to delay async ops for mock requests
var asyncDelay = 100;
var mockeryOpts = {
  warnOnReplace: false,
  warnOnUnregistered: false,
  useCleanCache: true
};

/**
 * Returns a mock client that also acts as a Channel and LiveRecording instance
 * to allow a single EventEmitter to be used for testing.
 *
 * The mock client is cached so tests can access it to emit events if
 * necessary.
 */
var getMockClient = function() {

  if (mockClient) {
    return mockClient;
  }

  var Client = function() {
    this.LiveRecording = function() {
      // reset recording name
      this.name = 'myrecording';
      return this;
    };

    this.getChannel = function() {
      return this;
    };

    // actually channel.caller
    this.caller = {
      name: 'caller',
      number: '1234'
    };

    // actually recording.name
    this.name = 'myrecording';

    // actually channel.record (will get denodeified)
    this.record = function(opts, recording, cb) {
      this.recordingName = recording.name;
      setTimeout(function() {
        cb(null);
      }, asyncDelay);
    };

    // actually recording.stop (will get denodeified)
    this.stop = function(cb) {
      var self = this;

      setTimeout(function() {
        cb(null);
        recordingFinished = true;
        self.emit('RecordingFinished', {event: 'RecordingFinished'}, {
          name: self.recordingName,
          duration: asyncDelay,

          removeListener: function() {}
        });
      }, asyncDelay);
    };
  };
  util.inherits(Client, Emitter);

  mockClient = new Client();

  return mockClient;
};

/**
 * Returns a mock config for testing.
 */
var getMockConfig = function() {
  var ariConfig = {
    url: '',
    username: '',
    password: '',
    applicationName: ''
  };

  return {
    getAppConfig: function() {
      return {
        ari: ariConfig,
        prompts: {
          mailboxWriter: {
            intro: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }]
          }
        }
      };
    },

    getMailboxConfig: function() {
      var innerDeferred = Q.defer();

      setTimeout(function() {
        innerDeferred.resolve({
          'msg_format': 'wav'
        });
      }, asyncDelay);

      return innerDeferred.promise;
    }
  };
};

/**
 * Returns a mock data access layer for testing.
 */
var getMockDal = function() {
  var dal = {
    folder: {
      all: function() {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          innerDeferred.resolve([{name: 'Inbox'}]);
        }, asyncDelay);

        return innerDeferred.promise;
      }
    },

    message: {
      create: function(mailbox, inbox, fields) {
        return {
          init: function() {
          },

          getMailbox: function() {
            return mailbox;
          },

          getFolder: function() {
            return inbox;
          },

          recording: fields.recording,
          duration: fields.duration,
          callerId: fields.callerId
        };
      },

      save: function(msg) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          message = msg;
          innerDeferred.resolve();
        }, asyncDelay);

        return innerDeferred.promise;
      }
    }
  };
  
  return dal;
};

/**
 * Returns a mock prompt helper for testing.
 */
var getMockPrompt = function() {
  var promptHelper = {
    create: function() {
      return {
        play: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            innerDeferred.resolve(true);
            promptFinished = true;
          }, asyncDelay);

          return innerDeferred.promise;
        },

        stop: function() {
          promptStopped = true;
        }
      };
    }
  };

  return promptHelper;
};

/**
 * Returns a mock dependencies object for testing.
 */
var getMockDependencies = function() {
  var dependencies = {
    config: getMockConfig(),
    dal: getMockDal(),
    prompt: getMockPrompt()
  };

  return dependencies;
};

/**
 * Returns a mock mailbox for testing.
 */
var getMockMailbox = function() {
  var mailbox = {
    getId: function() {
      return 1;
    }
  };
  
  return mailbox;
};

describe('mailbox', function() {

  beforeEach(function(done) {

    mockery.enable(mockeryOpts);

    var clientMock = {
      getClient: function(url, username, password, appName) {
        var deferred = Q.defer();
        deferred.resolve(getMockClient());

        return deferred.promise;
      }
    };
    mockery.registerMock('ari-client-wrapper', clientMock);

    done();
  });

  afterEach(function(done) {
    mockery.disable();
    recordingFinished = false;
    promptFinished = false;
    promptStopped = false;
    message = null;

    done();
  });

  it('should support recording a message', function(done) {
    var ari = require('ari-client-wrapper');
    var channel = getMockClient().getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createWriter(getMockMailbox(), channel);


    mailboxHelper.record()
      .then(function() {
        return mailboxHelper.save();
      })
      .then(function() {
        assert(recordingFinished);
        assert(!promptStopped);
        assert(message.recording === 'voicemail/1/myrecording');
        assert(message.duration === asyncDelay);

        done();
      })
      .done();

    stopInAWhile();

    /**
     * Call stop on mailbox helper once prompt has finished to simulate user
     * hearing beep before stopping recording.
     */
    function stopInAWhile() {
      setTimeout(function() {
        if (promptFinished) {
          mailboxHelper.stop();
        } else {
          stopInAWhile();
        }
      }, asyncDelay);
    }
  });

  it('should support stopping prompt', function(done) {
    var ari = require('ari-client-wrapper');
    var channel = getMockClient().getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createWriter(getMockMailbox(), channel);


    mailboxHelper.record()
      .then(function() {
        return mailboxHelper.save();
      })
      .then(function() {
        assert(recordingFinished);
        assert(promptStopped);
        assert(message.recording === 'voicemail/1/myrecording');
        assert(message.duration === asyncDelay);

        done();
      })
      .done();

    // stop prompt
    mailboxHelper.stop();

    // stop recording
    setTimeout(stopInAWhile, asyncDelay);

    /**
     * Call stop on mailbox helper once prompt has finished to simulate user
     * hearing beep before stopping recording.
     */
    function stopInAWhile() {
      setTimeout(function() {
        if (promptFinished) {
          mailboxHelper.stop();
        } else {
          stopInAWhile();
        }
      }, asyncDelay);
    }
  });

  it('should support using hangup to stop a recording', function(done) {
    var ari = require('ari-client-wrapper');
    var channel = getMockClient().getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createWriter(getMockMailbox(), channel);


    mailboxHelper.record()
      .then(function() {
        return mailboxHelper.save();
      })
      .then(function() {
        assert(recordingFinished);
        assert(!promptStopped);
        assert(message.recording === 'voicemail/1/myrecording');
        assert(message.duration === asyncDelay);

        done();
      })
      .done();

    hangupInAWhile();

    /**
     * Hangup once prompt has finished to simulate user hearing beep before
     * hanging up to stop recording.
     */
    function hangupInAWhile() {
      setTimeout(function() {
        if (promptFinished) {
          channel.emit('StasisEnd');
        } else {
          hangupInAWhile();
        }
      }, asyncDelay);
    }
  });

});
