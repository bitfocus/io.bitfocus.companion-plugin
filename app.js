/* global $CC, Utils, $SD */

/**
 * Here are a couple of wrappers we created to help ypu quickly setup
 * your plugin and subscribe to events sent by Stream Deck to your plugin.
 */

 /**
  * The 'connected' event is sent to your plugin, after the plugin's instance
  * is registered with Stream Deck software. It carries the current websocket
  * and other information about the current environmet in a JSON object
  * You can use it to subscribe to events you want to use in your plugin.
  */
let companion;
let pluginUUID = null;
let contextes = {};
let listeners = {};
let imagecache = {};
let defaultActionName = 'io.bitfocus.companion-plugin.action';

$SD.on('connected', (jsonObj) => connected(jsonObj));

function sendConnectionState(ctx) {
	var payload = {};

	if (!companion.isConnected) {
		payload = {
			connection: 'Connecting to locally running Companion... Make sure you have at least Companion version 1.3.0 or newer running on your computer',
			class: 'caution'
		};
	} else {
		payload = {
			connection: 'Connected',
			class: 'info',
			version: companion.remote_version
		};
	}

	$SD.api.sendToPropertyInspector(ctx, payload, defaultActionName);
}

function connected(jsn) {
	console.log("Initial data to know about: ", jsn);

	pluginUUID = jsn.uuid;
	companion = new companionConnection();

	// In the future, let people select external companion
	companion.setAddress('127.0.0.1');

	companion.on('connected', function () {
		console.log("New device with plugin UUID: ", pluginUUID);
	
		companion.apicommand('new_device', pluginUUID);
		companion.once('new_device:result', function (res) {
			console.log("New device result:", res);

			for (var key in listeners) {
				let [page, bank] = key.split(/_/);

				console.log("%c Initial request_button", 'border: 1px solid red', page, bank);
				companion.apicommand('request_button', { page, bank });
			}
		});
	
		for (var ctx in contextes) {
			sendConnectionState(ctx);
		}
	});

	companion.on('fillImage', function (data) {
		updateImageForIdx(data);
	});

	companion.on('disconnect', function () {
		for (var ctx in contextes) {
			updateImage(ctx);

			sendConnectionState(ctx);
		}
	});

    /** subscribe to the willAppear and other events */
    $SD.on('io.bitfocus.companion-plugin.action.willAppear', (jsonObj) => action.onWillAppear(jsonObj));
    $SD.on('io.bitfocus.companion-plugin.action.willDisappear', (jsonObj) => action.onWillDisappear(jsonObj));
    $SD.on('io.bitfocus.companion-plugin.action.keyUp', (jsonObj) => action.onKeyUp(jsonObj));
    $SD.on('io.bitfocus.companion-plugin.action.keyDown', (jsonObj) => action.onKeyDown(jsonObj));
    $SD.on('io.bitfocus.companion-plugin.action.sendToPlugin', (jsonObj) => action.onSendToPlugin(jsonObj));
    $SD.on('io.bitfocus.companion-plugin.action.didReceiveSettings', (jsonObj) => action.onDidReceiveSettings(jsonObj));
	$SD.on('io.bitfocus.companion-plugin.action.titleParametersDidChange', (...args) => action.titleParametersDidChange(...args));
	$SD.on('io.bitfocus.companion-plugin.action.propertyInspectorDidAppear', (jsonObj) => {
        console.log('%c%s', 'color: white; background: black; font-size: 13px;', '[app.js]propertyInspectorDidAppear:');
    });
    $SD.on('io.bitfocus.companion-plugin.action.propertyInspectorDidDisappear', (jsonObj) => {
        console.log('%c%s', 'color: white; background: red; font-size: 13px;', '[app.js]propertyInspectorDidDisappear:');
    });
};

function addListener(page, buttonselector, context) {
	const [x, y] = buttonselector.split(/:/);
	const bank = (x - 1) + ((y-1) * 8);
	const key = page + '_' + bank;

	if (page === 'dynamic') {
		return;
	}

	console.log("%c Add listener", 'border: 1px solid red');

	if (listeners[key] === undefined) {
		listeners[key] = [];
	}

	if (listeners[key].length === 0) {
		if (companion.isConnected) {
			companion.apicommand('request_button', { page, bank });
		}	
	}

	if (listeners[key].indexOf(context) === -1) {
		listeners[key].push(context);
	}
}

function removeListener(page, buttonselector, context) {
	const [x, y] = buttonselector.split(/:/);
	const bank = (x - 1) + ((y-1) * 8);
	const key = page + '_' + bank;

	if (page === 'dynamic') {
		return;
	}

	console.log("%c Remove listener", 'border: 1px solid red');

	if (listeners[key] === undefined) {
		return;
	}

	const idx = listeners[key].indexOf(context);
	if (idx !== -1) {
		listeners[key].splice(idx, 1);
	}

	if (listeners[key].length === 0) {
		companion.apicommand('unrequest_button', { page, bank });
		delete listeners[key];
		delete imagecache[page + '_' + bank];
	}
}

/** ACTIONS */
function getIndexFromCoordinate(data) {
	// Companion still expects rows to be 5 buttons per row, regardless of current
	// devices
	const coordinates = data.split(/:/);
	return (parseInt(coordinates[0]) - 1) + ((parseInt(coordinates[1])-1) * 8);
}

function updateImageForIdx(data) {
	let idx = data.keyIndex;
	let page = data.page;

	if (page !== undefined) {
		console.log("%cImage data for static button", 'border: 1px solid red', page, idx);
	} else {
		// Cache all dynamic images
		imagecache[idx] = data.data;
	}

	for (var ctx in contextes) {
		if (contextes[ctx].settings.buttonselector !== undefined) {
			if (page === undefined && contextes[ctx].settings.pageselector === 'dynamic') {
				var pos = getIndexFromCoordinate(contextes[ctx].settings.buttonselector);
				if (pos == idx) {	
					updateImage(ctx, data.data);
				}
			} else if (page !== undefined) {
				if (page !== undefined && page == contextes[ctx].settings.pageselector) {
					const [x, y] = contextes[ctx].settings.buttonselector.split(/:/);
					const pos = (x - 1) + ((y - 1) * 8);
				
					if (parseInt(pos) === parseInt(idx)) {
						imagecache[page + '_' + idx] = data.data;
						updateImage(ctx, data.data);
					}
				}
			}
		}
	}
}

function sendCanvasToSD(context, canvas) {
	console.log("sendCanvasToSD", context);
	$SD.api.setImage(context, canvas.toDataURL("image/png"), DestinationEnum.HARDWARE_AND_SOFTWARE);
}

function loadImageAsDataUri(url, callback) {
	var image = new Image();

	image.onload = function () {
		var canvas = document.createElement("canvas");

		canvas.width = this.naturalWidth;
		canvas.height = this.naturalHeight;

		var ctx = canvas.getContext("2d");
		ctx.drawImage(this, 0, 0);
		callback(canvas.toDataURL("image/png"));
	};

	image.src = url;
};

function updateImage(context, data) {
	console.log("Update image for context ", context);
	if (!companion.isConnected) {
		loadImageAsDataUri('img/actionNotConnected.png', function (imgUrl) {
			$SD.api.setImage(context, imgUrl, DestinationEnum.HARDWARE_AND_SOFTWARE);
		});
	} else {
		if (data === undefined) {
			if (
				contextes[context] !== undefined &&
				contextes[context].settings != undefined
			) {
				let page = contextes[context].settings.pageselector;
				let idx = getIndexFromCoordinate(contextes[context].settings.buttonselector);

				if (page !== 'dynamic') {
					idx = page + '_' + idx;
				}

				console.log("SHow image fo idx ", idx);
				if (imagecache[idx] !== undefined) {
					data = imagecache[idx];
				} else {
					return;
				}
			} else {
				return;
			}
		}

		var canvas = document.createElement("canvas");
		canvas.width = 72;
		canvas.height = 72;
		var imagebuffer = dataToButtonImage(data.data);

		var ctx = canvas.getContext("2d");
		ctx.putImageData(imagebuffer, 0, 0);

		sendCanvasToSD(context, canvas);
	}
}


function dataToButtonImage(data) {
	var sourceData = new Uint8Array(data);
	var imageData  = new ImageData(72, 72);

	var si = 0, di = 0;
	for (var y = 0; y < 72; ++y) {
		for (var x = 0; x < 72; ++x) {
			imageData.data[di++] = sourceData[si++];
			imageData.data[di++] = sourceData[si++];
			imageData.data[di++] = sourceData[si++];
			imageData.data[di++] = 255;
		}
	}

	return imageData;
}

const action = {
    settings:{},
    onDidReceiveSettings: function(jsn) {
        let settings = Utils.getProp(jsn, 'payload.settings', {});
		settings = this.newOrOldSettings(jsn, settings);

		console.log("Did receive settings", jsn);
		//contextes[jsn.context].settings = settings;

        this.setTitle(jsn);
		updateImage(jsn.context);
	},
	
	newOrOldSettings(jsn, settings) {
		if (settings === undefined || Object.keys(settings).length === 0) {
			settings = {};
	
			console.log("Converting from old or missing config to new");
			const currentButton = (jsn.payload.coordinates.column + 1) + ':' + (jsn.payload.coordinates.row + 1);
			console.log("Setting button to ", currentButton);
	
			this.saveSettings(jsn, {
				buttonselector: currentButton,
				pageselector: 'dynamic'
			});
	
			settings['buttonselector'] = currentButton;
			settings['pageselector'] = 'dynamic';
		}
		return settings;
	},

    /** 
     * The 'willAppear' event is the first event a key will receive, right before it gets
     * showed on your Stream Deck and/or in Stream Deck software.
     * This event is a good place to setup your plugin and look at current settings (if any),
     * which are embedded in the events payload.
     */

    onWillAppear: function (jsn) {
		const context = jsn.context;
        /**
         * "The willAppear event carries your saved settings (if any). You can use these settings
         * to setup your plugin or save the settings for later use. 
         * If you want to request settings at a later time, you can do so using the
         * 'getSettings' event, which will tell Stream Deck to send your data 
         * (in the 'didReceiceSettings above)
         * 
         * $SD.api.getSettings(jsn.context);
        */
        let settings = jsn.payload.settings;

		console.log("willAppear settings: ", settings);
		if (contextes[context] === undefined) {
			contextes[context] = {};
		}

		settings = this.newOrOldSettings(jsn, settings);

		contextes[context].settings = settings;

		this.setTitle(jsn);

		if (settings.pageselector && settings.pageselector != 'dynamic') {
			const page = settings.pageselector;

			addListener(page, settings.buttonselector, jsn.context);
		}

		// Show "disconnected icon if not connected"
		updateImage(context);
	},

	onWillDisappear: function (jsn) {
		let settings = $SD.api.getSettings(jsn.context);
		if (settings.pageselector && settings.pageselector != 'dynamic') {
			const page = settings.pageselector;

			removeListener(page, settings.buttonselector, jsn.context);
		}

	},

	onKeyDown: function (jsn) {
		const page = jsn.payload.settings.pageselector;
		const [x, y] = jsn.payload.settings.buttonselector.split(/:/);
		const bank = (x - 1) + ((y-1) * 8);
	
		if (page === 'dynamic') {
			companion.apicommand('keydown', { keyIndex: bank });
		} else {
			companion.apicommand('keydown', { page, bank });
		}
    },

    onKeyUp: function (jsn) {
		const page = jsn.payload.settings.pageselector;
		const [x, y] = jsn.payload.settings.buttonselector.split(/:/);
		const bank = (x - 1) + ((y-1) * 8);

		if (page === 'dynamic') {
			companion.apicommand('keyup', { keyIndex: bank });
		} else {
			companion.apicommand('keyup', { page, bank });
		}
    },

    onSendToPlugin: function (jsn) {
		const context = jsn.context;
        /**
         * this is a message sent directly from the Property Inspector 
         * (e.g. some value, which is not saved to settings) 
         * You can send this event from Property Inspector (see there for an example)
         */ 

        const sdpi_collection = Utils.getProp(jsn, 'payload.sdpi_collection', {});
        if (sdpi_collection.value && sdpi_collection.value !== undefined) {
			if (contextes[context].settings !== undefined && contextes[context].settings[sdpi_collection.key] != sdpi_collection.value) {
				if (contextes[context].settings.pageselector !== undefined && contextes[context].settings.buttonselector !== undefined) {
					removeListener(contextes[context].settings.pageselector, contextes[context].settings.buttonselector, context);
				}

				contextes[context].settings[sdpi_collection.key] = sdpi_collection.value;

				if (contextes[context].settings.pageselector !== undefined && contextes[context].settings.buttonselector !== undefined) {
					addListener(contextes[context].settings.pageselector, contextes[context].settings.buttonselector, context);
				}
			}
			updateImage(jsn.context);
			//this.doSomeThing({ [sdpi_collection.key] : sdpi_collection.value }, 'onSendToPlugin', 'fuchsia');
        }
		console.log("FROM PLUGIN", jsn);

		if (jsn.payload.command == 'get_connection') {
			sendConnectionState(context);
		}
		
	},

    saveSettings: function (jsn, newSettings) {
        console.log('saveSettings:', jsn, this);
		let settings = $SD.api.getSettings(jsn.context);
		if (settings === undefined) {
			settings = {};
		}

		settings = {
			...settings,
			...newSettings
		};

		contextes[jsn.context].settings = settings;
		console.log('setSettings....', newSettings, settings);

		$SD.api.setSettings(jsn.context, settings);
		$SD.api.sendToPropertyInspector(jsn.context, { settings }, defaultActionName);

		updateImage(jsn.context);
	},
	
	titleParametersDidChange: function (jsn) {
		this.setTitle(jsn);
	},

    setTitle: function(jsn) {
		$SD.api.setTitle(jsn.context, '', DestinationEnum.HARDWARE_AND_SOFTWARE);
    },


};

