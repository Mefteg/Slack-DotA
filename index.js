"use strict";

/* ########################################################################## */

var https = require('https');

var array = require('mout/array');
var string = require('mout/string');

var env = require('node-env-file');

var RtmClient = require('@slack/client').RtmClient;
var WebClient = require('@slack/client').WebClient;
var RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;

/* ########################################################################## */

const DEBUG = false;

env(__dirname + '/.env', {overwrite: true});

const BOT_TOKEN = process.env.SLACK_TOKEN || '';;

const BOT_REFRESH_TIME = 2 * 6 * 1000; // 2 minutes
const BOT_CHANNEL_TEST = 'bot_test';
const BOT_CHANNEL_PROD = 'general';
const BOT_CHANNEL = DEBUG ? BOT_CHANNEL_TEST : BOT_CHANNEL_PROD;

/* ########################################################################## */

var RTM = null;
var WEB = null;

var CHANNELS = {};

var USERS = [
    {
        'id': 65316354,
        'name': "Mefteg",
        'last_match': null
    },
    {
        'id': 43091316,
        'name': "SmK",
        'last_match': null
    },
    {
        'id': 117068811,
        'name': "Raza",
        'last_match': null
    },
    {
        'id': 17574498,
        'name': "Guiz",
        'last_match': null
    }
];

/* ########################################################################## */

function initTheBot(promise) {
    RTM = new RtmClient(BOT_TOKEN);
    WEB = new WebClient(BOT_TOKEN);

    WEB.channels.list(function(err, info) {
       if (err) {
           console.error('Error:', err);
       } else {
           for(var i in info.channels) {
               let c = info.channels[i];
               CHANNELS[c.name] = c.id;
           }
       }

       if (promise) {
           promise();
       }
    });

    // you need to wait for the client to fully connect before you can send messages
    RTM.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, function () {
        console.log("RTM connection opened.");
    });

    RTM.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
        var parsedText = ParseText(message.text);
        if (parsedText.length > 0) {
            RTM.sendMessage(parsedText, message.channel);
        }
    });
}

function startTheBot() {
    RTM.start();

    //start the loop
    setTimeout(loopTheBot, 5000);
}

function loopTheBot() {
    array.forEach(USERS, function(user, key, arr) {
        GetDotaLastMatchForUserId(user.id, function(err, data) {
            if (err) {
                console.error("Error: " + err);
                return;
            }

            // if no match are saved
            if (!user.last_match) {
                // save the match
                user.last_match = data;
                // but do nothing more
                // -> avoid spamming when launching the bot
                return;
            }

            // if a new match is available
            if (user.last_match.match_id != data.match_id) {
                // update with the new match
                user.last_match = data;
                // send the message
                RTM.sendMessage(CreateMessageUserLastMatch(user), CHANNELS[BOT_CHANNEL]);
            }
        });
    });

    setTimeout(loopTheBot, BOT_REFRESH_TIME);
}

/* ########################################################################## */

function HttpsGet(url, promise) {
    https.get(url, function(res) {
        let rawData = "";
        res.on('data', function(d) {
            rawData += d;
        });

        res.on('end', function() {
            let parsedData = {};
            try {
                parsedData = JSON.parse(rawData);
                promise(null, parsedData);
            } catch (e) {
                if (DEBUG) {
                    console.error("Parsing failed. Data: " + rawData);
                }
                promise(e);
            }
        })
    }).on('error', promise);
}

function GetDotaLastMatchForUserId(userId, promise) {
    var url = "https://api.opendota.com/api/players/" + userId + "/matches?limit=1";
    HttpsGet(url, function(err, data) {
        if (err) {
            promise(err);
            return;
        }

        var url = "https://api.opendota.com/api/players/" + userId + "/matches?limit=1&win=1";
        HttpsGet(url, function(err, dataLastWin) {
            if (err) {
                promise(err);
                return;
            }

            data[0].win = data[0].match_id == dataLastWin[0].match_id;

            promise(err, data[0]);
        });
    });
}

function CreateMessageUserLastMatch(user) {
    if (!user || !user.last_match) {
        return "";
    }

    var match = user.last_match;
    var gameUrl = "https://www.opendota.com/matches/" + match.match_id;
    return user.name + " " + (match.win ? "won" : "lost") + " a game: " + gameUrl;
}

function ParseText(text) {
    if (text == null || text.length < 2) {
        return "";
    }

    let parsedText = "";

    if (text[0] == '!')
    {
        if (text[1] == 'h') {
            parsedText = "\
            List of commands:\n\
            !h Display the list of commands.\n\
            !users List users.\n\
            !lastgameby username Display the last game of the specified user.";
        }
        else if (text == '!users') {
            let nbUsers = USERS.length;
            parsedText = "[";
            array.forEach(USERS, function(user, key) {
                parsedText += user.name + (key < (nbUsers-1) ? ", " : "");
            });
            parsedText += "]";
        }
        else if (string.startsWith(text, '!lastgameby')) {
            var split = text.split(" ");
            if (split.length > 0) {
                var username = split[1];
                var user = array.find(USERS, {name: username});
                if (user) {
                    parsedText = CreateMessageUserLastMatch(user);
                }
            }
        }
    }

    return parsedText;
}

/* ########################################################################## */

function main() {
    // init the bot then start it
    initTheBot(function() {
        startTheBot();
    });
}

main();
