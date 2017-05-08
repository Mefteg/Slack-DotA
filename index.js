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

env(__dirname + '/.env', {overwrite: true}); // get env variables

/* ########################################################################## */

const DEBUG = false;

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
    setTimeout(loopTheBot, 1000);
}

function loopTheBot() {
    GetDotaLastMatchForUsers_Recursive(USERS, 0, [], function(err, data) {
        if (err) {
            console.error("Error: " + err);
            return;
        }

        var isAllowedToSendMessage = USERS[0].last_match != null;

        var matches = GetMatchesFromUsersLastMatchData(USERS, data);

        for (var i=0; i<matches.length; ++i) {
            var currentMatch = matches[i];
            var usersInMatch = matches[i].users_in_match;

            if (usersInMatch.length == 0) {
                continue;
            }

            var firstUserInMatch = USERS[usersInMatch[0]];

            // if the data has already been updated
            if (firstUserInMatch.last_match != null && firstUserInMatch.last_match.match_id == currentMatch.match_id) {
                // skip this match
                continue;
            }

            // update users last match data
            for (var j=0; j<usersInMatch.length; ++j) {
                var currentUser = USERS[usersInMatch[j]];

                if (currentUser.last_match == null || currentUser.last_match.match_id != currentMatch.match_id) {
                    currentUser.last_match = currentMatch;
                }
            }

            if (isAllowedToSendMessage) {
                // send the message
                RTM.sendMessage(CreateMessageUsersLastMatch(USERS, usersInMatch), CHANNELS[BOT_CHANNEL]);
            }
        }
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

function GetDotaLastMatchForUsers_Recursive(users, index, data, promise) {
    // if we get all users' data
    if (index >= users.length) {
        promise(null, data);
    }
    // otherwise, get recursively users' data
    else {
        GetDotaLastMatchForUserId(users[index].id, function(error, userData) {
            if (error) {
                promise(error);
                return;
            }

            // store current user data
            data.push(userData);

            // get next user's data
            GetDotaLastMatchForUsers_Recursive(users, (index + 1), data, promise);
        });
    }
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

function GetMatchesFromUsersLastMatchData(users, usersLastMatchData) {
    var matches = [];

    // for each user last match data
    for (var i=0; i<usersLastMatchData.length; ++i) {
        var currentUserLastMatchData = usersLastMatchData[i];

        // check if the match has already been stored
        var alreadyStored = false;
        for (var j=0; j<matches.length; ++j) {
            if (matches[j].match_id == currentUserLastMatchData.match_id) {
                matches[j].users_in_match.push(i); // add the user
                alreadyStored = true;
                break;
            }
        }

        if (alreadyStored == false) {
            matches.push(currentUserLastMatchData);
            matches[matches.length - 1].users_in_match = []; // create array for users in the match
            matches[matches.length - 1].users_in_match.push(i);
        }
    }

    return matches;
}

function CreateMessageUserLastMatch(user) {
    if (!user || !user.last_match) {
        return "";
    }

    var match = user.last_match;
    var gameUrl = "https://www.opendota.com/matches/" + match.match_id;
    return user.name + " " + (match.win ? "won" : "lost") + " a game: " + gameUrl;
}

function CreateMessageUsersLastMatch(users, usersInMatch) {
    if (!usersInMatch || usersInMatch.length == 0) {
        return "";
    }

    var match = users[usersInMatch[0]].last_match;
    var gameUrl = "https://www.opendota.com/matches/" + match.match_id;
    var txtUsers = "";
    for (var i=0; i<usersInMatch.length; ++i) {
        var currentUser = users[usersInMatch[i]];
        if (i == 0) {
            txtUsers += currentUser.name;
        }
        else if (i<(usersInMatch.length - 1)) {
            txtUsers += ", " + currentUser.name;
        }
        else {
            txtUsers += " and " + currentUser.name;
        }
    }

    return txtUsers + " " + (match.win ? "won" : "lost") + " a game: " + gameUrl;
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
