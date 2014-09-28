# Asterisk Voicemail Mailbox Interface

Mailbox interface for Asterisk voicemail. This module supports interacting with mailboxes and the messages they contain.

# Installation

```bash
$ git clone https://github.com/asterisk/node-voicemail-mailbox.git
$ cd node-voicemail-mailbox
$ npm install -g .
```

or add the following the your package.json file

```JavaScript
"dependencies": {
  "voicemail-mailbox": "asterisk/node-voicemail-mailbox"
}
```

# Usage

Create a mailbox writer instance:

```JavaScript
var dal; // voicemail data access layer instance
var promptHelper; // voicemail prompt instance
var config; // voicemail config instance
var mailboxHelper = require('voicemail-mailbox')({
  dal: dal,
  prompt: promptHelper,
  config, config
});
var channel; // channel instance
var mailbox; // mailbox instance

var writer = mailboxHelper.createWriter(mailbox, channel);
```

For more information on voicemail data access layer, see [voicemail-data](http://github.com/asterisk/node-voicemail-data). For more information on voicemail prompt, see [voicemail-prompt](http://github.com/asterisk/node-voicemail-prompt). For more information on voicemail config, see [voicemail-config](http://github.com/asterisk/node-voicemail-config)


Start recording a message for the mailbox:

```JavaScript
writer.record()
  .then(function() {
    // recording has finished
  })
  .catch(function(err) {
  });
```

Stop the recording at any point (this can also be used to stop playing the prompt that plays before the recording is started):

```JavaScript
writer.stop();
```

After the recording has finished, save the recording to the mailbox:

```JavaScript
writer.save()
  .then(function() {
    // recording saved
  })
  .catch(function(err) {
  });
```

# Development

After cloning the git repository, run the following to install the module and all dev dependencies:

```bash
$ npm install
$ npm link
```

Then run the following to run jshint and mocha tests:

```bash
$ grunt
```

jshint will enforce a minimal style guide. It is also a good idea to create unit tests when adding new features.

# License

Apache, Version 2.0. Copyright (c) 2014, Digium, Inc. All rights reserved.

