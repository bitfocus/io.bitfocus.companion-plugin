/*
 * This file is part of the Companion project
 * Copyright (c) 2019 Bitfocus AS
 * Authors: Håkon Nessjøen <haakon@bitfocus.io>, William Viker <william@bitfocus.io>
 *
 * This program is free software.
 * You should have received a copy of the MIT licence as well as the Bitfocus
 * Individual Contributor License Agreement for companion along with
 * this program.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the Companion software without
 * disclosing the source code of your own applications.
 *
 */
function companionConnection(address) {
	const self = this;
	self.events = {};

	self.address = address;
	self.isConnected = false;

	self.timer = setInterval(function () {
		if (self.websocket === undefined || !self.isConnected) {
			console.log('Not connected?');
			self.connect();
		}
	}, 5000);
}
InjectEventEmitter(companionConnection);
// companionConnection.prototype = new EventEmitter();

companionConnection.prototype.setAddress = function(address) {
	const self = this;
	console.log('cc: setAddress', address);

	self.address = address;

	if (self.isConnected) {
		self.connect();
	}
};

companionConnection.prototype.apicommand = function (command, args) {
	const self = this;

	if (self.websocket.readyState === 1) {
		self.websocket.send(JSON.stringify({ command: command, arguments: args }));
	} else {
		console.warn('Could not send ' + command + ' when not connected.');
	}
};

companionConnection.prototype.connect = function() {
	const self = this;

	console.log('cc: connect');
	const websocket = self.websocket = new WebSocket('ws://' + self.address + ':28492');

	websocket.onopen = function () {
		self.isConnected = true;
		self.removeAllListeners('version:result');
		self.apicommand('version', { version: 2 });
		self.once('version:result', function (args) {
			if (args.error) {
				console.warn('Error connecting: ', args);
			}
			self.remote_version = args.version;
			console.log('Version result:', args);

			if (self.remote_version === 1) {
				console.log('old version');
				self.emit('wrongversion');
				websocket.close();
			} else {
				console.log('connected');
				self.emit('connected');
			}
		});
	};

	websocket.onerror = function (evt) {
		console.warn('WEBSOCKET ERROR', evt, evt.data);
	};

	websocket.onclose = function (evt) {
		// Websocket is closed
		console.log(
			'[COMPANION]***** WEBSOCKET CLOSED **** reason:',
			evt.code
		);

		self.isConnected = false;
		self.emit('disconnect');
	};

	websocket.onmessage = function (evt) {
		if (evt.data) {
			try {
				const data = JSON.parse(evt.data);
				if (data.response !== undefined) {
					self.emit(data.response + ':result', data.arguments);
					console.log('Emitting response:', data.response);
				} else {
					self.emit(data.command, data.arguments);
				}
			} catch (e) {
				console.warn('Cannot parse wsapi packet:', evt.data, e);
			}
		}
		// console.log('Got message:', evt);
	};
};
