﻿/*global window:false */
/// <reference path="jquery.signalR.core.js" />

(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events;

    signalR.transports = {};

    function checkIfAlive(connection) {
        var keepAliveData = connection.keepAliveData;

        // Only check if we're connected
        if (connection.state === signalR.connectionState.connected) {
            var diff = new Date(),
                timeElapsed;

            diff.setTime(diff - keepAliveData.lastKeepAlive);
            timeElapsed = diff.getTime();

            // Check if the keep alive has completely timed out
            if (timeElapsed >= keepAliveData.timeout) {
                connection.log("Keep alive timed out.  Notifying transport that connection has been lost.");

                // Notify transport that the connection has been lost
                connection.transport.lostConnection(connection);
            }
            else if (timeElapsed >= keepAliveData.timeoutWarning) {
                connection.log("Keep alive has been missed, connection may be dead/slow.");
                $(connection).triggerHandler(events.onConnectionSlow);
            }
        }

        // Verify we're monitoring the keep alive
        if (keepAliveData.monitoring) {
            window.setTimeout(function () {
                checkIfAlive(connection);
            }, keepAliveData.checkInterval);
        }
    }

    signalR.transports._logic = {
        addQs: function (url, connection) {
            if (!connection.qs) {
                return url;
            }

            if (typeof (connection.qs) === "object") {
                return url + "&" + $.param(connection.qs);
            }

            if (typeof (connection.qs) === "string") {
                return url + "&" + connection.qs;
            }

            return url + "&" + window.escape(connection.qs.toString());
        },

        getUrl: function (connection, transport, reconnecting, appendReconnectUrl) {
            /// <summary>Gets the url for making a GET based connect request</summary>
            var baseUrl = transport === "webSockets" ? "" : connection.baseUrl,
                url = baseUrl + connection.appRelativeUrl,
                qs = "transport=" + transport + "&connectionId=" + window.escape(connection.id);

            if (connection.data) {
                qs += "&connectionData=" + window.escape(connection.data);
            }

            if (!reconnecting) {
                url = url + "/connect";
            } else {
                if (appendReconnectUrl) {
                    url = url + "/reconnect";
                }
                if (connection.messageId) {
                    qs += "&messageId=" + connection.messageId;
                }
                if (connection.groups) {
                    qs += "&groups=" + window.escape(JSON.stringify(connection.groups));
                }
            }
            url += "?" + qs;
            url = this.addQs(url, connection);
            url += "&tid=" + Math.floor(Math.random() * 11);
            return url;
        },

        ajaxSend: function (connection, data) {
            var url = connection.url + "/send" + "?transport=" + connection.transport.name + "&connectionId=" + window.escape(connection.id);
            url = this.addQs(url, connection);
            return $.ajax({
                url: url,
                global: false,
                type: connection.ajaxDataType === "jsonp" ? "GET" : "POST",
                dataType: connection.ajaxDataType,
                data: {
                    data: data
                },
                success: function (result) {
                    if (result) {
                        $(connection).trigger(events.onReceived, [result]);
                    }
                },
                error: function (errData, textStatus) {
                    if (textStatus === "abort" ||
                        (textStatus === "parsererror" && connection.ajaxDataType === "jsonp")) {
                        // The parsererror happens for sends that don't return any data, and hence
                        // don't write the jsonp callback to the response. This is harder to fix on the server
                        // so just hack around it on the client for now.
                        return;
                    }
                    $(connection).trigger(events.onError, [errData]);
                }
            });
        },

        ajaxAbort: function (connection, async) {
            if (typeof (connection.transport) === "undefined") {
                return;
            }

            // Async by default unless explicitly overidden
            async = typeof async === "undefined" ? true : async;

            var url = connection.url + "/abort" + "?transport=" + connection.transport.name + "&connectionId=" + window.escape(connection.id);
            url = this.addQs(url, connection);
            $.ajax({
                url: url,
                async: async,
                timeout: 1000,
                global: false,
                type: "POST",
                dataType: connection.ajaxDataType,
                data: {}
            });

            connection.log("Fired ajax abort async = " + async);
        },

        processMessages: function (connection, data) {
            var $connection = $(connection);

            // If our transport supports keep alive then we need to update the last keep alive time stamp.
            if (connection.transport.supportsKeepAlive) {
                this.updateKeepAlive(connection);
            }

            if (!data) {
                return;
            }

            if (data.Disconnect) {
                connection.log("Disconnect command received from server");

                // Disconnected by the server
                connection.stop();
                return;
            }

            if (data.Messages) {
                $.each(data.Messages, function () {
                    try {
                        $connection.trigger(events.onReceived, [this]);
                    }
                    catch (e) {
                        connection.log("Error raising received " + e);
                        $(connection).trigger(events.onError, [e]);
                    }
                });
            }

            if (data.MessageId) {
                connection.messageId = data.MessageId;
            }

            if (data.TransportData) {
                connection.groups = data.TransportData.Groups;
            }
        },

        monitorKeepAlive: function (connection) {
            var keepAliveData = connection.keepAliveData;

            // If we haven't initiated the keep alive timeouts then we need to
            if (!keepAliveData.monitoring) {
                keepAliveData.monitoring = true;

                // Initialize the keep alive time stamp ping
                this.updateKeepAlive(connection);

                connection.log("Now monitoring keep alive with a warning timeout of " + keepAliveData.timeoutWarning + " and a connection lost timeout of " + keepAliveData.timeout);
                // Start the monitoring of the keep alive
                checkIfAlive(connection);
            }
            else {
                connection.log("Tried to monitor keep alive but it's already being monitored");
            }
        },

        stopMonitoringKeepAlive: function (connection) {
            var keepAliveData = connection.keepAliveData;

            // Only attempt to stop the keep alive monitoring if its being monitored
            if (keepAliveData.monitoring) {
                // Stop monitoring
                keepAliveData.monitoring = false;

                // Clear all the keep alive data
                keepAliveData = {};
                connection.log("Stopping the monitoring of the keep alive");
            }
        },

        updateKeepAlive: function (connection) {
            connection.keepAliveData.lastKeepAlive = new Date();
        },

        foreverFrame: {
            count: 0,
            connections: {}
        }
    };

}(window.jQuery, window));