#io.bitfocus.companion-plugin

Companion plugin for the native Stream Deck application

## Getting Started

1. To contribute to this plugin, first follow the instructions provided by the Streamdeck SDK to set up a development environment: https://docs.elgato.com/streamdeck/sdk/introduction/getting-started
1. You will need to install the Elgagto Streamdeck CLI: `yarn global add @elgato/cli`
1. Clone this repository and install dependencies by running `yarn` in the repo folder.
1. Make your code changes as necessary.
1. If you are editing any Property Inspectors, you can refer to the SDPI documentation here: https://sdpi-components.dev/
1. Run `yarn build` to ensure everything compiles correctly.
1. If the plugin is already installed in the Elgato Stream Deck software, uninstall it.
1. Run `yarn run link`.
1. Run `yarn run restart` in the repo folder.
1. If you are making frequent code changes, you can run `yarn run watch` which will automatically recompile the source code as needed.

Submit your changes as a pull request to this repository.

## Debugging

You can view the "server side" logs by opening one of the log files in the `./io.bitfocus.companion-plugin.sdPlugin/logs/` folder.

To view the "client side" logs:

1. Make sure development mode is enabled by running `streamdeck dev`.
1. Open the Property Inspector for the Action you are editing.
1. Open a browser window to: `http://127.0.0.1:23654`
1. This web page will show a list of plugins you can view. You can then open the dev tools page for this plugin.
1. View the console output and inspect elements using this interface.

## Packaging

If you want to provide a packaged file for others: `yarn pack`
