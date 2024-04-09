// @ts-check
/// <reference path="libs/js/action.js" />
/// <reference path="libs/js/stream-deck.js" />

const myAction = new Action('io.bitfocus.companion-plugin.action');

const companionClient = new CompanionConnection()
let pluginUUID=null

/**
 * The first event fired when Stream Deck starts
 */
$SD.onConnected(({ actionInfo, appInfo, connection, messageType, port, uuid }) => {
	console.log("Streamdeck software connected!");
	pluginUUID = uuid;
  
  
	loadImageAsDataUri("img/actionNotConnected.png", (imgUrl) => {
	  notConnectedImage = imgUrl;
  
	  // Ensure buttons have the initial drawing
	  for (const context of Object.keys(actionItems)) {
		redrawCachedImageForActionItem(context);
	  }
  
	  // In the future, let people select external companion
	  companionClient.setAddress("127.0.0.1");
  
	  companionClient.on("wrongversion", () => {
		for (let ctx in actionItems) {
		  errorstate =
			"You need to install Companion 2.4 or newer and enable support for this plugin in the Settings tab";
		  sendConnectionState(ctx);
		}
	  });
  
	  companionClient.on("connected", () => {
		console.log("New device with plugin UUID: ", pluginUUID);
  
		companionClient.removeAllListeners("new_device:result");
		companionClient.apicommand("new_device", pluginUUID);
		companionClient.once("new_device:result", (res) => {
		  console.log("New device result:", res);
  
		  for (const key of keyImageListeners.keys()) {
			let [page, bank] = key.split(/_/);
  
			console.log(
			  "%c Initial request_button",
			  "border: 1px solid red",
			  page,
			  bank
			);
			companionClient.apicommand("request_button", { page, bank });
		  }
		});
  
		for (let actionItemId in actionItems) {
		  sendConnectionState(actionItemId);
		}
	  });
  
	  companionClient.on("fillImage", (data) => {
		console.log("fillImage", data);
		receivedNewImage(data);
	  });
  
	  companionClient.on("disconnect", () => {
		for (let actionItemId in actionItems) {
		  redrawCachedImageForActionItem(actionItemId);
  
		  sendConnectionState(actionItemId);
		}
		errorstate = undefined;
	  });
	});
});

myAction.onKeyUp(({ action, context, device, event, payload }) => {
	console.log('Your key code goes here!');
});

myAction.onDialRotate(({ action, context, device, event, payload }) => {
	console.log('Your dial code goes here!');
});
