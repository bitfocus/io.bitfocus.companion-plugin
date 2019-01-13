/* global debug, Color, connectSocket, $SD */
/* eslint no-undef: "error",
  curly: 0,
  no-caller: 0
*/

var DestinationEnum = Object.freeze({
    HARDWARE_AND_SOFTWARE: 0,
    HARDWARE_ONLY: 1,
    SOFTWARE_ONLY: 2
});

var debug = debug || false,
    debugLog;
debug = false;
if (debug) debugLog = console.log.bind(window.console);
else debugLog = function () {};

var Utils = {
    isUndefined: function (value) {
        return typeof value === 'undefined';
    },
    isObject: function (o) {
        return (
            typeof o === 'object' &&
            o !== null &&
            o.constructor &&
            o.constructor === Object
        );
    },
    isPlainObject: function (o) {
        return (
            typeof o === 'object' &&
            o !== null &&
            o.constructor &&
            o.constructor === Object
        );
    },
    isArray: function (value) {
        return Array.isArray(value);
    },
    isNumber: function (value) {
        return typeof value === 'number' && value !== null;
    },
    isInteger (value) {
        return typeof value === 'number' && value === Number(value);
    },
    isString (value) {
        return typeof value === 'string';
    },
    isImage (value) {
        return value instanceof HTMLImageElement;
    },
    isCanvas (value) {
        return value instanceof HTMLCanvasElement;
    },
    isValue: function (value) {
        return !this.isObject(value) && !this.isArray(value);
    },
    isNull: function (value) {
        return value === null;
    },
    toInteger: function (value) {
        var INFINITY = 1 / 0,
            MAX_INTEGER = 1.7976931348623157e308;
        if (!value) {
            return value === 0 ? value : 0;
        }
        value = Number(value);
        if (value === INFINITY || value === -INFINITY) {
            var sign = value < 0 ? -1 : 1;
            return sign * MAX_INTEGER;
        }
        return value === value ? value : 0;
    }
};
Utils.minmax = function (v, min, max) {
    return Math.min(max, Math.max(min, v));
};

Utils.randomComponentName = function (len = 6) {
    return `${Utils.randomLowerString(len)}-${Utils.randomLowerString(len)}`;
};

Utils.randomString = function (len = 8) {
    return Array.apply(0, Array(len))
        .map(function () {
            return (function (charset) {
                return charset.charAt(
                    Math.floor(Math.random() * charset.length)
                );
            })(
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
            );
        })
        .join('');
};
Utils.randomLowerString = function (len = 8) {
    return Array.apply(0, Array(len))
        .map(function () {
            return (function (charset) {
                return charset.charAt(
                    Math.floor(Math.random() * charset.length)
                );
            })('abcdefghijklmnopqrstuvwxyz');
        })
        .join('');
};

Utils.capitalize = function (str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

Utils.count = 0;
Utils.counter = function () {
    return (this.count += 1);
};
Utils.getPrefix = function () {
    return this.prefix + this.counter();
};

Utils.prefix = Utils.randomString() + '_';

Utils.getUrlParameter = function (name) {
    const nameA = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + nameA + '=([^&#]*)');
    var results = regex.exec(location.search.replace(/\/$/, ''));
    return results === null
        ? null
        : decodeURIComponent(results[1].replace(/\+/g, ' '));
};

Utils.debounce = function (func, wait = 100) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
};

Utils.getRandomColor = function () {
    return '#' + (((1 << 24) * Math.random()) | 0).toString(16);
    // var letters = '0123456789ABCDEF';
    // var color = '#';
    // for (var i = 0; i < 6; i++) {
    //   color += letters[Math.floor(Math.random() * 16)];
    // }
    // return color;
};

Utils.lerpColor = function (startColor, targetColor, amount) {
    const ah = parseInt(startColor.replace(/#/g, ''), 16);
    const ar = ah >> 16;
    const ag = (ah >> 8) & 0xff;
    const ab = ah & 0xff;
    const bh = parseInt(targetColor.replace(/#/g, ''), 16);
    const br = bh >> 16;
    var bg = (bh >> 8) & 0xff;
    var bb = bh & 0xff;
    const rr = ar + amount * (br - ar);
    const rg = ag + amount * (bg - ag);
    const rb = ab + amount * (bb - ab);

    return (
        '#' +
        (((1 << 24) + (rr << 16) + (rg << 8) + rb) | 0)
            .toString(16)
            .slice(1)
            .toUpperCase()
    );
};

Utils.hexToRgb = function (hex) {
    const match = hex.replace(/#/, '').match(/.{1,2}/g);
    return {
        r: parseInt(match[0], 16),
        g: parseInt(match[1], 16),
        b: parseInt(match[2], 16)
    };
};

Utils.getBrightness = function (hexColor) {
    // http://www.w3.org/TR/AERT#color-contrast
    if (typeof hexColor === 'string' && hexColor.charAt(0) === '#') {
        var rgb = Utils.hexToRgb(hexColor);
        return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    }
    return 0;
};

Utils.readJson = function (file, callback) {
    var req = new XMLHttpRequest();
    req.onerror = function (e) {
        console.log(`[Utils][readJson] Error while trying to read  ${file}`, e);
    };
    req.overrideMimeType('application/json');
    req.open('GET', file, true);
    req.onreadystatechange = function () {
        if (req.readyState === 4) {
            // && req.status == "200") {
            if (callback) callback(req.responseText);
        }
    };
    req.send(null);
};

Utils.loadScript = function (url, callback) {
    var el = document.createElement('script');
    el.src = url;
    el.onload = function () {
        callback(url, true);
    };
    el.onerror = function () {
        console.error('Failed to load file: ' + url);
        callback(url, false);
    };
    document.body.appendChild(el);
};

Utils.parseJson = function (jsonString) {
    if (typeof jsonString === 'object') return jsonString;
    try {
        var o = JSON.parse(jsonString);

        // Handle non-exception-throwing cases:
        // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
        // but... JSON.parse(null) returns null, and typeof null === "object",
        // so we must check for that, too. Thankfully, null is falsey, so this suffices:
        if (o && typeof o === 'object') {
            return o;
        }
    } catch (e) {}

    return false;
};

Utils.parseJSONPromise = function (jsonString) {
    // fetch('/my-json-doc-as-string')
    // .then(Utils.parseJSONPromise)
    // .then(heresYourValidJSON)
    // .catch(error - or return default JSON)

    return new Promise((resolve, reject) => {
        try {
            resolve(JSON.parse(jsonString));
        } catch (e) {
            reject(e);
        }
    });
};

/* eslint-disable import/prefer-default-export */
Utils.getProperty = function (obj, dotSeparatedKeys, defaultValue) {
    if (arguments.length > 1 && typeof dotSeparatedKeys !== 'string')
        return undefined;
    if (typeof obj !== 'undefined' && typeof dotSeparatedKeys === 'string') {
        const pathArr = dotSeparatedKeys.split('.');
        pathArr.forEach((key, idx, arr) => {
            if (typeof key === 'string' && key.includes('[')) {
                try {
                    // extract the array index as string
                    const pos = /\[([^)]+)\]/.exec(key)[1];
                    // get the index string length (i.e. '21'.length === 2)
                    const posLen = pos.length;
                    arr.splice(idx + 1, 0, Number(pos));

                    // keep the key (array name) without the index comprehension:
                    // (i.e. key without [] (string of length 2)
                    // and the length of the index (posLen))
                    arr[idx] = key.slice(0, -2 - posLen); // eslint-disable-line no-param-reassign
                } catch (e) {
                    // do nothing
                }
            }
        });
        // eslint-disable-next-line no-param-reassign, no-confusing-arrow
        obj = pathArr.reduce(
            (o, key) => (o && o[key] !== 'undefined' ? o[key] : undefined),
            obj
        );
    }
    return obj === undefined ? defaultValue : obj;
};

Utils.getProp = function (jsonObj, path, separator) {
    try {
        separator = separator || '.';
        return path
            .replace('[', separator)
            .replace(']', '')
            .split(separator)
            .reduce(function (obj, property) {
                return obj[property];
            }, jsonObj);
    } catch (err) {
        return undefined;
    }
};

Utils.setProp = function (jsonObj, path, value) {
    const names = path.split('.');
    let jsn = jsonObj;

    // createNestedObject(jsn, names, values);
    // If a value is given, remove the last name and keep it for later:
    var targetProperty = arguments.length === 3 ? names.pop() : false;

    // Walk the hierarchy, creating new objects where needed.
    // If the lastName was removed, then the last object is not set yet:
    for (var i = 0; i < names.length; i++) {
        jsn = jsn[names[i]] = jsn[names[i]] || {};
    }

    // If a value was given, set it to the target property (the last one):
    if (targetProperty) jsn = jsn[targetProperty] = value;

    // Return the last object in the hierarchy:
    return jsn;
};

/** createNestedObject( window, ["shapes", "triangle", "points"] );
 */
var createNestedObject1 = function (base, names, values) {
    for (var i in names) {
        base = base[names[i]] = base[names[i]] || (values[i] || {});
        console.log('[createNestedObject]', i, base, names[i], values[i]);
    }
};

var createNestedObject = function (base, names, value) {
    // If a value is given, remove the last name and keep it for later:
    var lastName = arguments.length === 3 ? names.pop() : false;

    // Walk the hierarchy, creating new objects where needed.
    // If the lastName was removed, then the last object is not set yet:
    for (var i = 0; i < names.length; i++) {
        base = base[names[i]] = base[names[i]] || {};
    }

    // If a value was given, set it to the last name:
    if (lastName) base = base[lastName] = value;

    // Return the last object in the hierarchy:
    return base;
};

Utils.getDataUri = function (url, callback, inCanvas, inFillcolor) {
    var image = new Image();

    image.onload = function () {
        var canvas =
            inCanvas && Utils.isCanvas(inCanvas)
                ? inCanvas
                : document.createElement('canvas');

        canvas.width = this.naturalWidth; // or 'width' if you want a special/scaled size
        canvas.height = this.naturalHeight; // or 'height' if you want a special/scaled size

        var ctx = canvas.getContext('2d');
        if (inFillcolor) {
            ctx.fillStyle = inFillcolor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(this, 0, 0);
        // Get raw image data
        // callback && callback(canvas.toDataURL('image/png').replace(/^data:image\/(png|jpg);base64,/, ''));

        // ... or get as Data URI
        callback(canvas.toDataURL('image/png'));
    };

    image.src = url;
};

Utils.getData = function (url) {
    // Return a new promise.
    return new Promise(function (resolve, reject) {
        // Do the usual XHR stuff
        var req = new XMLHttpRequest();
        // Make sure to call .open asynchronously
        req.open('GET', url, true);

        req.onload = function () {
            // This is called even on 404 etc
            // so check the status
            if (req.status === 200) {
                // Resolve the promise with the response text
                resolve(req.response);
            } else {
                // Otherwise reject with the status text
                // which will hopefully be a meaningful error
                reject(Error(req.statusText));
            }
        };

        // Handle network errors
        req.onerror = function () {
            reject(Error('Network Error'));
        };

        // Make the request
        req.send();
    });
};

Utils.negArray = function (arr) {
    /** http://h3manth.com/new/blog/2013/negative-array-index-in-javascript/ */
    return Proxy.create({
        set: function (proxy, index, value) {
            index = parseInt(index);
            return index < 0 ? (arr[arr.length + index] = value) : (arr[index] = value);
        },
        get: function (proxy, index) {
            index = parseInt(index);
            return index < 0 ? arr[arr.length + index] : arr[index];
        }
    });
};

Utils.onChange = function (object, callback) {
    /** https://github.com/sindresorhus/on-change */
    'use strict';
    const handler = {
        get (target, property, receiver) {
            try {
                console.log('get via Proxy: ', property, target, receiver);
                return new Proxy(target[property], handler);
            } catch (err) {
                console.log('get via Reflect: ', err, property, target, receiver);
                return Reflect.get(target, property, receiver);
            }
        },
        set (target, property, value, receiver) {
            console.log('Utils.onChange:set1:', target, property, value, receiver);
            //target[property] = value;
            const b = Reflect.set(target, property, value);
            console.log('Utils.onChange:set2:', target, property, value, receiver);
            return b;
        },
        defineProperty (target, property, descriptor) {
            console.log('Utils.onChange:defineProperty:', target, property, descriptor);
            callback(target, property, descriptor);
            return Reflect.defineProperty(target, property, descriptor);
        },
        deleteProperty (target, property) {
            console.log('Utils.onChange:deleteProperty:', target, property);
            callback(target, property);
            return Reflect.deleteProperty(target, property);
        }
    };

    return new Proxy(object, handler);
};

Utils.observeArray = function (object, callback) {
    'use strict';
    const array = [];
    const handler = {
        get (target, property, receiver) {
            try {
                return new Proxy(target[property], handler);
            } catch (err) {
                return Reflect.get(target, property, receiver);
            }
        },
        set (target, property, value, receiver) {
            console.log('XXXUtils.observeArray:set1:', target, property, value, array);
            target[property] = value;
            console.log('XXXUtils.observeArray:set2:', target, property, value, array);
        },
        defineProperty (target, property, descriptor) {
            callback(target, property, descriptor);
            return Reflect.defineProperty(target, property, descriptor);
        },
        deleteProperty (target, property) {
            callback(target, property, descriptor);
            return Reflect.deleteProperty(target, property);
        }
    };

    return new Proxy(object, handler);
};

window['_'] = Utils;

// Create a wrapper to allow passing JSON to the socket
WebSocket.prototype.sendJSON = function (jsn, log) {
    if (log) {
        console.log('SendJSON', this, jsn);
    }
    // if (this.readyState) {
    this.send(JSON.stringify(jsn));
    // }
};

function fix_settings (key, vlu) {
    if (key === 'settings' && typeof vlu === 'string') {
        console.log(
            '************************** fix_settings',
            key,
            vlu,
            typeof vlu
        );
        return Utils.parseJson(vlu);
    }
    return vlu;
}

/**
 * connectSocket
 * This is the first function StreamDeck Software calls, when
 * establishing the connection to the plugin or the Property Inspector
 * @param {string} inPort - The socket's port to communicate with StreamDeck software.
 * @param {string} inUUID - A unique identifier, which StreamDeck uses to communicate with the plugin
 * @param {string} inMessageType - Identifies, if the event is meant for the property inspector or the plugin.
 * @param {string} inApplicationInfo - Information about the host (StreamDeck) application
 * @param {string} inActionInfo - Context is an internal identifier used to communicate to the host application.
 **/

function connectSocket (
    inPort,
    inUUID,
    inMessageType,
    inApplicationInfo,
    inActionInfo
) {
    console.log('connectSocket......', arguments);
    StreamDeck.getInstance().connect(arguments);
}

/**
 * StreamDeck object containing all required code to establish
 * communication with SD-Software and the Property Inspector
 */

const StreamDeck = (function () {
    // Hello it's me
    var instance;
    /*
      Populate and initialize internally used properties
    */

    function init () {
        // *** PRIVATE ***

        var inPort,
            inUUID,
            inMessageType,
            inApplicationInfo,
            inActionInfo,
            websocket = null;

        var events = ELGEvents.eventEmitter();
        var logger = SDDebug.logger();

        function showVars () {
            debugLog('---- showVars');
            debugLog('- port', inPort);
            debugLog('- uuid', inUUID);
            debugLog('- messagetype', inMessageType);
            debugLog('- info', inApplicationInfo);
            debugLog('- inActionInfo', inActionInfo);
            debugLog('----< showVars');
        }

        function connect (args) {
            inPort = args[0];
            inUUID = args[1];
            inMessageType = args[2];
            inApplicationInfo = Utils.parseJson(args[3]);
            inActionInfo =
                args[4] !== 'undefined' ? Utils.parseJson(args[4]) : args[4];

            /** Debug variables */
            if (debug) {
                showVars();
            }

            /** restrict the API to what's possible
             * within Plugin or Property Inspector
             * <unused for now>
             */
            // $SD.api = SDApi[inMessageType];

            if (websocket) {
                websocket.close();
                websocket = null;
            };

            websocket = new WebSocket('ws://localhost:' + inPort);

            websocket.onopen = function () {
                var json = {
                    event: inMessageType,
                    uuid: inUUID
                };

                // console.log('***************', inMessageType + "  websocket:onopen", inUUID, json);

                websocket.sendJSON(json);

                instance.emit('connected', {
                    connection: websocket,
                    port: inPort,
                    uuid: inUUID,
                    plugin: inActionInfo,
                    info: inApplicationInfo,
                    messageType: inMessageType
                });
            };

            websocket.onerror = function (evt) {
                console.warn('WEBOCKET ERROR', evt, evt.data);
            };

            websocket.onclose = function (evt) {
                // Websocket is closed
                var reason = WEBSOCKETERROR(evt);
                console.log(
                    '[STREAMDECK]***** WEBOCKET CLOSED **** reason:',
                    reason
                );

            };

            websocket.onmessage = function (evt) {
                var jsonObj = Utils.parseJson(evt.data);
                var m = '';

                 console.log('[STREAMDECK] websocket.onmessage ... ', evt);

                if (!jsonObj.hasOwnProperty('action')) {
                    m = jsonObj.event;
                    console.log('%c%s','color: white; background: red; font-size: 12px;', '[common.js]', m);
                } else {
                    switch (inMessageType) {
                    case 'registerPlugin':
                        m = jsonObj['action'] + '.' + jsonObj['event'];
                        break;
                    case 'registerPropertyInspector':
                        m = 'sendToPropertyInspector';

                        break;
                    default:
                        console.log('+++++++++  PROBLEM ++++++++');
                        console.log('UNREGISTERED MESSAGETYPE:', inMessageType);
                    }
                }

                if (m && m !== '')
                    events.emit(m, jsonObj);
            };

            instance.connection = websocket;
        }

        return {
            // *** PUBLIC ***

            uuid: inUUID,
            on: events.on,
            emit: events.emit,
            connection: websocket,
            connect: connect,
            api: null,
            logger: logger
        };
    }

    return {
        getInstance: function () {
            if (!instance) {
                instance = init();
                // console.log(">>>>>>> INSTANCE", instance);
            }
            return instance;
        }
    };
})();

/** ELGEvents
 * Publish/Subscribe pattern to quickly signal events to
 * the plugin, property inspector and data.
 */

const ELGEvents = {
    eventEmitter: function (name, fn) {
        const eventList = new Map();

        const on = (name, fn) => {
            if (!eventList.has(name)) eventList.set(name, ELGEvents.pubSub());

            return eventList.get(name).sub(fn);
        };

        const has = (name) =>
            eventList.has(name);

        const emit = (name, data) =>
            eventList.has(name) && eventList.get(name).pub(data);

        return Object.freeze({ on, has, emit, eventList });
    },

    pubSub: function pubSub () {
        const subscribers = new Set();

        const sub = fn => {
            subscribers.add(fn);
            return () => {
                subscribers.delete(fn);
            };
        };

        const pub = data => subscribers.forEach(fn => fn(data));
        return Object.freeze({ pub, sub });
    }
};

/** SDApi
 * This ist the main API to communicate between plugin, property inspector and
 * application host.
 * Internal functions:
 * - setContext: sets the context of the current plugin
 * - exec: prepare the correct JSON structure and send
 *
 * Methods exposed in the $SD.api alias
 * Messages send from the plugin
 * -----------------------------
 * - showAlert
 * - showOK
 * - setSettings
 * - setTitle
 * - setImage
 * - sendToPropertyInspector
 *
 * Messages send from Property Inspector
 * -------------------------------------
 * - sendToPlugin
 *
 * Messages received in the plugin
 * -------------------------------
 * willAppear
 * willDisappear
 * keyDown
 * keyUp
 */

const SDApi = {
    send: function (context, fn, payload, debug) {
        /** Combine the passed JSON with the name of the event and it's context
         * If the payload contains 'event' or 'context' keys, it will overwrite existing 'event' or 'context'.
         * This function is non-mutating and thereby creates a new object containing
         * all keys of the original JSON objects.
         */
        // console.log("SEND...........", payload)
        const pl = Object.assign({}, { event: fn, context: context }, payload);

        /** Check, if we have a connection, and if, send the JSON payload */
        if (debug) {
            console.log('-----SDApi.send-----');
            console.log(pl);
            console.log(payload.payload);
            console.log(JSON.stringify(payload.payload));
            console.log('-------');
        }
        $SD.connection && $SD.connection.sendJSON(pl);

        /**
         * DEBUG-Utility to quickly show the current payload in the Property Inspector.
         */

        if (
            $SD.connection &&
            [
                'sendToPropertyInspector',
                'showOK',
                'showAlert',
                'setSettings'
            ].indexOf(fn) === -1
        ) {
            // console.log("send.sendToPropertyInspector", payload);
            // this.sendToPropertyInspector(context, typeof payload.payload==='object' ? JSON.stringify(payload.payload) : JSON.stringify({'payload':payload.payload}), pl['action']);
        }
    },

    // registerPlugin: {

    /** Messages send from the plugin */
    showAlert: function (context) {
        this.send(context, 'showAlert', {});
    },

    showOk: function (context) {
        this.send(context, 'showOk', {});
    },

    setSettings: function (context, payload) {
        this.send(context, 'setSettings', {
            payload: payload
        });
    },

    setTitle: function (context, title, target) {
        this.send(context, 'setTitle', {
            payload: {
                title: '' + title || '',
                target: target || DestinationEnum.HARDWARE_AND_SOFTWARE
            }
        });
    },

    setImage: function (context, img, target) {
        this.send(context, 'setImage', {
            payload: {
                image: img || '',
                target: target || DestinationEnum.HARDWARE_AND_SOFTWARE
            }
        });
    },

    sendToPropertyInspector: function (context, payload, action) {
        this.send(context, 'sendToPropertyInspector', {
            action: action,
            payload: payload
        });
    },
    // },

    /** Messages send from Property Inspector */

    // registerPropertyInspector: {

    sendToPlugin: function (piUUID, action, payload) {
        this.send(
            piUUID,
            'sendToPlugin',
            {
                action: action,
                payload: payload || {}
            },
            false
        );
    },
    // },

    /** Messages received in the plugin: */

    /** COMMON */

    debugPrint: function (context, inString) {
        // console.log("------------ DEBUGPRINT");
        // console.log([].slice.apply(arguments).join());
        // console.log("------------ DEBUGPRINT");
        this.send(context, 'debugPrint', {
            payload: [].slice.apply(arguments).join('.') || ''
        });
    },

    dbgSend: function (fn, context) {
        /** lookup if an appropriate function exists */
        if ($SD.connection && this[fn] && typeof this[fn] === 'function') {
            /** verify if type of payload is an object/json */
            const payload = this[fn]();
            if (typeof payload === 'object') {
                Object.assign({ event: fn, context: context }, payload);
                $SD.connection && $SD.connection.sendJSON(payload);
            }
        }
        console.log(this, fn, typeof this[fn], this[fn]());
    }
};

/** SDDebug
 * Utility to log the JSON structure of an incoming object
 */

const SDDebug = {
    logger: function (name, fn) {
        const logEvent = jsn => {
            console.log('____SDDebug.logger.logEvent');
            console.log(jsn);
            debugLog('-->> Received Obj:', jsn);
            debugLog('jsonObj', jsn);
            debugLog('event', jsn['event']);
            debugLog('actionType', jsn['actionType']);
            debugLog('settings', jsn['settings']);
            debugLog('coordinates', jsn['coordinates']);
            debugLog('---');
        };

        const logSomething = jsn =>
            console.log('____SDDebug.logger.logSomething');

        return { logEvent, logSomething };
    }
};

/**
 * This is the instance of the StreamDeck object.
 * There's only one StreamDeck object, which carries
 * connection parameters and handles communication
 * to/from the software's PluginManager.
 */

window.$SD = StreamDeck.getInstance();
window.$SD.api = SDApi;

function WEBSOCKETERROR (evt) {
    // Websocket is closed
    var reason = '';
    if (evt.code === 1000) {
        reason = 'Normal Closure. The purpose for which the connection was established has been fulfilled.';
    } else if (evt.code === 1001) {
        reason = 'Going Away. An endpoint is "going away", such as a server going down or a browser having navigated away from a page.';
    } else if (evt.code === 1002) {
        reason = 'Protocol error. An endpoint is terminating the connection due to a protocol error';
    } else if (evt.code === 1003) {
        reason = "Unsupported Data. An endpoint received a type of data it doesn't support.";
    } else if (evt.code === 1004) {
        reason = '--Reserved--. The specific meaning might be defined in the future.';
    } else if (evt.code === 1005) {
        reason = 'No Status. No status code was actually present.';
    } else if (evt.code === 1006) {
        reason = 'Abnormal Closure. The connection was closed abnormally, e.g., without sending or receiving a Close control frame';
    } else if (evt.code === 1007) {
        reason = 'Invalid frame payload data. The connection was closed, because the received data was not consistent with the type of the message (e.g., non-UTF-8 [http://tools.ietf.org/html/rfc3629]).';
    } else if (evt.code === 1008) {
        reason = 'Policy Violation. The connection was closed, because current message data "violates its policy". This reason is given either if there is no other suitable reason, or if there is a need to hide specific details about the policy.';
    } else if (evt.code === 1009) {
        reason = 'Message Too Big. Connection closed because the message is too big for it to process.';
    } else if (evt.code === 1010) { // Note that this status code is not used by the server, because it can fail the WebSocket handshake instead.
        reason = "Mandatory Ext. Connection is terminated the connection because the server didn't negotiate one or more extensions in the WebSocket handshake. <br /> Mandatory extensions were: " + evt.reason;
    } else if (evt.code === 1011) {
        reason = 'Internl Server Error. Connection closed because it encountered an unexpected condition that prevented it from fulfilling the request.';
    } else if (evt.code === 1015) {
        reason = "TLS Handshake. The connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).";
    } else {
        reason = 'Unknown reason';
    }

    return reason;
}

const SOCKETERRORS = {
    '0': 'The connection has not yet been established',
    '1': 'The connection is established and communication is possible',
    '2': 'The connection is going through the closing handshake',
    '3': 'The connection has been closed or could not be opened'
};
