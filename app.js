/* global $CC, Utils, $SD */

/**
 * Here are a couple of wrappers we created to help ypu quickly setup
 * your plugin and subscribe to events sent by Stream Deck to your plugin.
 */

let companionClient;
let pluginUUID = null;
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
        "Connecting to locally running Companion... Make sure you have at least Companion version 1.3.0 or newer running on your computer",
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

function loadImageAsDataUri(url, callback) {
  const image = new Image();

  image.onload = function () {
    var canvas = document.createElement("canvas");

    canvas.width = this.naturalWidth;
    canvas.height = this.naturalHeight;

    var ctx = canvas.getContext("2d");
    ctx.drawImage(this, 0, 0);
    callback(canvas.toDataURL("image/png"));
  };

  image.src = url;
}

/**
 * The 'connected' event is sent to your plugin, after the plugin's instance
 * is registered with Stream Deck software. It carries the current websocket
 * and other information about the current environmet in a JSON object
 * You can use it to subscribe to events you want to use in your plugin.
 */
$SD.on("connected", (jsn) => {
  console.log("Initial data to know about: ", jsn);

  loadImageAsDataUri("img/actionNotConnected.png", (imgUrl) => {
    notConnectedImage = imgUrl;

    pluginUUID = jsn.uuid;
    companionClient = new CompanionConnection();

    // In the future, let people select external companion
    companionClient.setAddress("10.42.13.197");

    companionClient.on("wrongversion", () => {
      for (let ctx in actionItems) {
        errorstate =
          "You need to install companion 2.0 or newer to use this plugin";
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
      updateImageForIdx(data);
    });

    companionClient.on("disconnect", () => {
      for (let actionItemId in actionItems) {
        updateImageForActionItem(actionItemId);

        sendConnectionState(actionItemId);
      }
      errorstate = undefined;
    });
  });
});

/** subscribe to the willAppear and other events */
$SD.on("io.bitfocus.companion-plugin.action.willAppear", (jsonObj) =>
  action.onWillAppear(jsonObj)
);
$SD.on("io.bitfocus.companion-plugin.action.willDisappear", (jsonObj) =>
  action.onWillDisappear(jsonObj)
);
$SD.on("io.bitfocus.companion-plugin.action.keyUp", (jsonObj) =>
  action.onKeyUp(jsonObj)
);
$SD.on("io.bitfocus.companion-plugin.action.keyDown", (jsonObj) =>
  action.onKeyDown(jsonObj)
);
$SD.on("io.bitfocus.companion-plugin.action.sendToPlugin", (jsonObj) =>
  action.onSendToPlugin(jsonObj)
);
$SD.on("io.bitfocus.companion-plugin.action.didReceiveSettings", (jsonObj) =>
  action.onDidReceiveSettings(jsonObj)
);
$SD.on(
  "io.bitfocus.companion-plugin.action.titleParametersDidChange",
  (...args) => action.titleParametersDidChange(...args)
);
$SD.on(
  "io.bitfocus.companion-plugin.action.propertyInspectorDidAppear",
  (jsonObj) => {
    console.log(
      "%c%s",
      "color: white; background: black; font-size: 13px;",
      "[app.js]propertyInspectorDidAppear:"
    );
  }
);
$SD.on(
  "io.bitfocus.companion-plugin.action.propertyInspectorDidDisappear",
  (jsonObj) => {
    console.log(
      "%c%s",
      "color: white; background: red; font-size: 13px;",
      "[app.js]propertyInspectorDidDisappear:"
    );
  }
);

function addKeyImageListener(page, buttonselector, actionItemId) {
  if (page === "dynamic") {
    return;
  }

  const [x, y] = buttonselector.split(/:/);
  const bank = x - 1 + (y - 1) * 8;
  const key = page + "_" + bank;

  console.log("%c Add listener", "border: 1px solid red", actionItemId, key);

  let listeners = keyImageListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    keyImageListeners.set(key, listeners);
  }

  if (listeners.size === 0) {
    if (companionClient.isConnected) {
      companionClient.apicommand("request_button", { page, bank });
    }
  }

  listeners.add(actionItemId);
}

function removeKeyImageListener(page, buttonselector, actionItemId) {
  if (page === "dynamic") {
    return;
  }

  const bank = getKeyIndexFromCoordinate(buttonselector);
  const key = page + "_" + bank;

  console.log("%c Remove listener", "border: 1px solid red", actionItemId, key);

  const listeners = keyImageListeners.get(key);
  if (!listeners) {
    return;
  }

  listeners.remove(actionItemId);

  if (listeners.size === 0) {
    companionClient.apicommand("unrequest_button", { page, bank });
    keyImageListeners.delete(key);
    delete imagecache[page + "_" + bank];
  }
}

/** ACTIONS */
function getKeyIndexFromCoordinate(buttonselector) {
  const coordinates = buttonselector.split(/:/);
  return parseInt(coordinates[0]) - 1 + (parseInt(coordinates[1]) - 1) * 8;
}

function updateImageForIdx(data) {
  let idx = data.keyIndex;
  let page = data.page;

  if (page !== undefined) {
    console.log(
      "%cImage data for static button",
      "border: 1px solid red",
      page,
      idx
    );
  } else {
    // Cache all dynamic images
    imagecache[idx] = data.data;
  }

  for (var ctx in actionItems) {
    if (actionItems[ctx].settings.buttonselector !== undefined) {
      if (
        page === undefined &&
        actionItems[ctx].settings.pageselector === "dynamic"
      ) {
        var pos = getKeyIndexFromCoordinate(
          actionItems[ctx].settings.buttonselector
        );
        if (pos == idx) {
          updateImageForActionItem(ctx, data.data);
        }
      } else if (page !== undefined) {
        if (
          page !== undefined &&
          page == actionItems[ctx].settings.pageselector
        ) {
          const [x, y] = actionItems[ctx].settings.buttonselector.split(/:/);
          const pos = x - 1 + (y - 1) * 8;

          if (parseInt(pos) === parseInt(idx)) {
            imagecache[page + "_" + idx] = data.data;
            updateImageForActionItem(ctx, data.data);
          }
        }
      }
    }
  }
}

function sendCanvasToSD(context, canvas) {
  console.log("sendCanvasToSD", context);
  $SD.api.setImage(
    context,
    canvas.toDataURL("image/png"),
    DestinationEnum.HARDWARE_AND_SOFTWARE
  );
}

function updateImageForActionItem(context, data) {
  //console.log("Update image for context ", context);
  if (!companionClient.isConnected) {
    $SD.api.setImage(
      context,
      notConnectedImage,
      DestinationEnum.HARDWARE_AND_SOFTWARE
    );
  } else {
    if (data === undefined) {
      if (
        actionItems[context] !== undefined &&
        actionItems[context].settings != undefined
      ) {
        let page = actionItems[context].settings.pageselector;
        let idx = getKeyIndexFromCoordinate(
          actionItems[context].settings.buttonselector
        );

        if (page !== "dynamic") {
          idx = page + "_" + idx;
        }

        //console.log("SHow image fo idx ", idx);
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
  var imageData = new ImageData(72, 72);

  var si = 0,
    di = 0;
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
  settings: {},
  onDidReceiveSettings: function (jsn) {
    let settings = Utils.getProp(jsn, "payload.settings", {});
    settings = this.newOrOldSettings(jsn, settings);

    console.log("Did receive settings", jsn);
    //contextes[jsn.context].settings = settings;

    this.setTitle(jsn);
    updateImageForActionItem(jsn.context);
  },

  newOrOldSettings(jsn, settings) {
    if (settings === undefined || Object.keys(settings).length === 0) {
      settings = {};

      console.log("Converting from old or missing config to new");
      const currentButton =
        jsn.payload.coordinates.column +
        1 +
        ":" +
        (jsn.payload.coordinates.row + 1);
      console.log("Setting button to ", currentButton);

      this.saveSettings(jsn, {
        buttonselector: currentButton,
        pageselector: "dynamic",
      });

      settings.buttonselector = currentButton;
      settings.pageselector = "dynamic";
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
    console.log("onWillAppear", jsn);
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

    if (actionItems[context] === undefined) {
      actionItems[context] = {};
    }

    settings = this.newOrOldSettings(jsn, settings);

    actionItems[context].settings = settings;

    this.setTitle(jsn);

    if (settings.pageselector && settings.pageselector != "dynamic") {
      const page = settings.pageselector;

      addKeyImageListener(page, settings.buttonselector, jsn.context);
    }

    // Show "disconnected icon if not connected"
    updateImageForActionItem(context);
  },

  onWillDisappear: function (jsn) {
    console.log("onWillDisappear", jsn);
    let settings = jsn.payload.settings;

    if (settings.pageselector && settings.pageselector != "dynamic") {
      const page = settings.pageselector;

      removeKeyImageListener(page, settings.buttonselector, jsn.context);
    }
  },

  onKeyDown: function (jsn) {
    const page = jsn.payload.settings.pageselector;
    const [x, y] = jsn.payload.settings.buttonselector.split(/:/);
    const bank = x - 1 + (y - 1) * 8;

    if (page === "dynamic") {
      companionClient.apicommand("keydown", { keyIndex: bank });
    } else {
      companionClient.apicommand("keydown", { page, bank });
    }
  },

  onKeyUp: function (jsn) {
    const page = jsn.payload.settings.pageselector;
    const [x, y] = jsn.payload.settings.buttonselector.split(/:/);
    const bank = x - 1 + (y - 1) * 8;

    if (page === "dynamic") {
      companionClient.apicommand("keyup", { keyIndex: bank });
    } else {
      companionClient.apicommand("keyup", { page, bank });
    }
  },

  onSendToPlugin: function (jsn) {
    const context = jsn.context;
    /**
     * this is a message sent directly from the Property Inspector
     * (e.g. some value, which is not saved to settings)
     * You can send this event from Property Inspector (see there for an example)
     */

    const sdpi_collection = Utils.getProp(jsn, "payload.sdpi_collection", {});
    if (sdpi_collection.value && sdpi_collection.value !== undefined) {
      if (
        actionItems[context].settings !== undefined &&
        actionItems[context].settings[sdpi_collection.key] !=
          sdpi_collection.value
      ) {
        if (
          actionItems[context].settings.pageselector !== undefined &&
          actionItems[context].settings.buttonselector !== undefined
        ) {
          removeKeyImageListener(
            actionItems[context].settings.pageselector,
            actionItems[context].settings.buttonselector,
            context
          );
        }

        actionItems[context].settings[sdpi_collection.key] =
          sdpi_collection.value;

        if (
          actionItems[context].settings.pageselector !== undefined &&
          actionItems[context].settings.buttonselector !== undefined
        ) {
          addKeyImageListener(
            actionItems[context].settings.pageselector,
            actionItems[context].settings.buttonselector,
            context
          );
        }
      }
      updateImageForActionItem(jsn.context);
      //this.doSomeThing({ [sdpi_collection.key] : sdpi_collection.value }, 'onSendToPlugin', 'fuchsia');
    }
    console.log("FROM PLUGIN", jsn);

    if (jsn.payload.command == "get_connection") {
      sendConnectionState(context);
    }
  },

  saveSettings: function (jsn, newSettings) {
    console.log("saveSettings:", jsn, this);
    let settings = $SD.api.getSettings(jsn.context);
    if (settings === undefined) {
      settings = {};
    }

    settings = {
      ...settings,
      ...newSettings,
    };

    actionItems[jsn.context].settings = settings;
    console.log("setSettings....", newSettings, settings);

    $SD.api.setSettings(jsn.context, settings);
    $SD.api.sendToPropertyInspector(
      jsn.context,
      { settings },
      defaultActionName
    );

    updateImageForActionItem(jsn.context);
  },

  titleParametersDidChange: function (jsn) {
    this.setTitle(jsn);
  },

  setTitle: function (jsn) {
    $SD.api.setTitle(jsn.context, "", DestinationEnum.HARDWARE_AND_SOFTWARE);
  },
};
