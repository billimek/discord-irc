'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _irc = require('irc');

var _irc2 = _interopRequireDefault(_irc);

var _winston = require('winston');

var _winston2 = _interopRequireDefault(_winston);

var _discord = require('discord.js');

var _discord2 = _interopRequireDefault(_discord);

var _errors = require('./errors');

var _validators = require('./validators');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var REQUIRED_FIELDS = ['server', 'nickname', 'channelMapping', 'discordToken'];
var NICK_COLORS = ['light_blue', 'dark_blue', 'light_red', 'dark_red', 'light_green', 'dark_green', 'magenta', 'light_magenta', 'orange', 'yellow', 'cyan', 'light_cyan'];

/**
 * An IRC bot, works as a middleman for all communication
 * @param {object} options - server, nickname, channelMapping, outgoingToken, incomingURL
 */

var Bot = function () {
  function Bot(options) {
    var _this = this;

    _classCallCheck(this, Bot);

    REQUIRED_FIELDS.forEach(function (field) {
      if (!options[field]) {
        throw new _errors.ConfigurationError('Missing configuration field ' + field);
      }
    });

    (0, _validators.validateChannelMapping)(options.channelMapping);

    this.discord = new _discord2.default.Client({ autoReconnect: true });

    this.server = options.server;
    this.nickname = options.nickname;
    this.ircOptions = options.ircOptions;
    this.discordToken = options.discordToken;
    this.commandCharacters = options.commandCharacters || [];
    this.ircNickColor = options.ircNickColor !== false; // default to true
    this.channels = _lodash2.default.values(options.channelMapping);

    this.channelMapping = {};

    // Remove channel passwords from the mapping and lowercase IRC channel names
    _lodash2.default.forOwn(options.channelMapping, function (ircChan, discordChan) {
      _this.channelMapping[discordChan] = ircChan.split(' ')[0].toLowerCase();
    });

    this.invertedMapping = _lodash2.default.invert(this.channelMapping);
    this.autoSendCommands = options.autoSendCommands || [];
  }

  _createClass(Bot, [{
    key: 'connect',
    value: function connect() {
      _winston2.default.debug('Connecting to IRC and Discord');
      this.discord.loginWithToken(this.discordToken);

      var ircOptions = _extends({
        userName: this.nickname,
        realName: this.nickname,
        channels: this.channels,
        floodProtection: true,
        floodProtectionDelay: 500,
        retryCount: 10
      }, this.ircOptions);

      this.ircClient = new _irc2.default.Client(this.server, this.nickname, ircOptions);
      this.attachListeners();
    }
  }, {
    key: 'attachListeners',
    value: function attachListeners() {
      var _this2 = this;

      this.discord.on('ready', function () {
        _winston2.default.debug('Connected to Discord');
      });

      this.ircClient.on('registered', function (message) {
        _winston2.default.debug('Registered event: ', message);
        _this2.autoSendCommands.forEach(function (element) {
          var _ircClient;

          (_ircClient = _this2.ircClient).send.apply(_ircClient, _toConsumableArray(element));
        });
      });

      this.ircClient.on('error', function (error) {
        _winston2.default.error('Received error event from IRC', error);
      });

      this.discord.on('error', function (error) {
        _winston2.default.error('Received error event from Discord', error);
      });

      this.discord.on('message', function (message) {
        // Ignore bot messages and people leaving/joining
        _this2.sendToIRC(message);
      });

      this.ircClient.on('message', this.sendToDiscord.bind(this));

      this.ircClient.on('notice', function (author, to, text) {
        _this2.sendToDiscord(author, to, '*' + text + '*');
      });

      this.ircClient.on('action', function (author, to, text) {
        _this2.sendToDiscord(author, to, '_' + text + '_');
      });

      this.ircClient.on('invite', function (channel, from) {
        _winston2.default.debug('Received invite:', channel, from);
        if (!_this2.invertedMapping[channel]) {
          _winston2.default.debug('Channel not found in config, not joining:', channel);
        } else {
          _this2.ircClient.join(channel);
          _winston2.default.debug('Joining channel:', channel);
        }
      });
    }
  }, {
    key: 'parseText',
    value: function parseText(message) {
      var _this3 = this;

      var text = message.mentions.reduce(function (content, mention) {
        return content.replace('<@' + mention.id + '>', '@' + mention.username);
      }, message.content);

      return text.replace(/\n|\r\n|\r/g, ' ').replace(/<#(\d+)>/g, function (match, channelId) {
        var channel = _this3.discord.channels.get('id', channelId);
        return '#' + channel.name;
      });
    }
  }, {
    key: 'isCommandMessage',
    value: function isCommandMessage(message) {
      return this.commandCharacters.indexOf(message[0]) !== -1;
    }
  }, {
    key: 'sendToIRC',
    value: function sendToIRC(message) {
      var _this4 = this;

      var author = message.author;
      // Ignore messages sent by the bot itself:
      if (author.id === this.discord.user.id) return;

      // Ignore PMs
      if (!message.channel.server) return;
      var channelName = message.channel.server.id + ',#' + message.channel.name;

      var ircChannel = this.channelMapping[channelName];

      //"debug: Channel Mapping discord-irc,#general undefined"
      _winston2.default.debug('Channel Mapping', channelName, this.channelMapping[channelName]);
      if (ircChannel) {
        (function () {
          var username = author.username;
          var text = _this4.parseText(message);
          var displayUsername = username;
          if (_this4.ircNickColor) {
            var colorIndex = (username.charCodeAt(0) + username.length) % NICK_COLORS.length;
            displayUsername = _irc2.default.colors.wrap(NICK_COLORS[colorIndex], username);
          }

          if (_this4.isCommandMessage(text)) {
            var prelude = 'Command sent from Discord by ' + username + ':';
            _this4.ircClient.say(ircChannel, prelude);
            _this4.ircClient.say(ircChannel, text);
          } else {
            if (text !== '') {
              text = '<' + displayUsername + '> ' + text;
              _winston2.default.debug('Sending message to IRC', ircChannel, text);
              _this4.ircClient.say(ircChannel, text);
            }

            if (message.attachments && message.attachments.length) {
              message.attachments.forEach(function (a) {
                var urlMessage = '<' + displayUsername + '> ' + a.url;
                _winston2.default.debug('Sending attachment URL to IRC', ircChannel, urlMessage);
                _this4.ircClient.say(ircChannel, urlMessage);
              });
            }
          }
        })();
      }
    }
  }, {
    key: 'sendToDiscord',
    value: function sendToDiscord(author, channel, text) {
      var _this5 = this;

      var discordServerChannelName = this.invertedMapping[channel.toLowerCase()];
      if (discordServerChannelName) {
        // #channel -> channel before retrieving:
        var discordServerName = discordServerChannelName.split(',')[0];
        var discordChannelName = discordServerChannelName.split(',')[1].toLowerCase();
        var discordChannel = this.discord.servers.get('id', discordServerName).channels.get('name', discordChannelName.slice(1));

        if (!discordChannel) {
          _winston2.default.info('Tried to send a message to a channel the bot isn\'t in: ', discordChannelName);
          return;
        }

        var withMentions = text.replace(/@[^\s]+\b/g, function (match) {
          var user = _this5.discord.users.get('username', match.substring(1));
          return user ? user.mention() : match;
        });

        // Add bold formatting:
        var withAuthor = '**<' + author + '>** ' + withMentions;
        _winston2.default.debug('Sending message to Discord', withAuthor, channel, '->', discordChannelName);
        this.discord.sendMessage(discordChannel, withAuthor);
      }
    }
  }]);

  return Bot;
}();

exports.default = Bot;