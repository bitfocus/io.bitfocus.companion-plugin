/* global $CC, Utils, $SD */

/**
 * Here are a couple of wrappers we created to help ypu quickly setup
 * your plugin and subscribe to events sent by Stream Deck to your plugin.
 */

// let companionClient;
// let pluginUUID = null;
const actionItems = {};
const keyImageListeners = new Map();
const imagecache = {};
const defaultActionName = "io.bitfocus.companion-plugin.action";
let errorstate;
let notConnectedImage;

function sendConnectionState(actionItemId) {
  let payload = {};

  if (errorstate) {
    payload = {
      connection: errorstate,
      class: "caution",
    };
  } else if (!companionClient.isConnected) {
    payload = {
      connection:
        "Connecting to locally running Companion... Make sure you have at least Companion version 2.4.0 or newer and that you have enabled support for the Elgato Plugin",
      class: "caution",
    };
  } else {
    payload = {
      connection: "Connected",
      class: "info",
      version: companionClient.remote_version,
    };
  }

  $SD.api.sendToPropertyInspector(actionItemId, payload, defaultActionName);
}


/**
 * The 'connected' event is sent to your plugin, after the plugin's instance
 * is registered with Stream Deck software. It carries the current websocket
 * and other information about the current environmet in a JSON object
 * You can use it to subscribe to events you want to use in your plugin.
 */
$SD.on("connected", (jsn) => {
  console.log("Initial data to know about: ", jsn);
  
  pluginUUID = jsn.uuid;

});

