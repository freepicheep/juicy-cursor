import AnimatedCursorPlugin from "src/main";
import { App, PluginSettingTab, Setting } from "obsidian"

export class AnimatedCursorSettingTab extends PluginSettingTab {
	public readonly plugin: AnimatedCursorPlugin;

	constructor(app: App, plugin: AnimatedCursorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	public display(): void {
		new Setting(this.containerEl)
			.setName("Slightly more smoothly")
			.setDesc(
				"If turned on, cursor moves slightly more smoothly, especially when the user moves it continously. " +
				"There is a downside, the cursor appears blurry."
			)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useTransform)
				.onChange(val => {
					this.plugin.settings.useTransform = val;
					this.plugin.saveSettings();
				})
			);

		new Setting(this.containerEl)
			.setName("Cursor Width")
			.setDesc("The width of the cursor (e.g. 2px, 5px)")
			.addText(text => text
				.setValue(this.plugin.settings.cursorWidth)
				.onChange(val => {
					this.plugin.settings.cursorWidth = val;
					this.plugin.saveSettings();
				})
			);

		new Setting(this.containerEl)
			.setName("Cursor Height")
			.setDesc("The height of the cursor (e.g. 100%, 20px)")
			.addText(text => text
				.setValue(this.plugin.settings.cursorHeight)
				.onChange(val => {
					this.plugin.settings.cursorHeight = val;
					this.plugin.saveSettings();
				})
			);

		new Setting(this.containerEl)
			.setName("Cursor Color")
			.setDesc("The color of the cursor (e.g. #ff0000, red, currentColor)")
			.addText(text => text
				.setValue(this.plugin.settings.cursorColor)
				.onChange(val => {
					this.plugin.settings.cursorColor = val;
					this.plugin.saveSettings();
				})
			);

		new Setting(this.containerEl)
			.setName("Cursor Radius")
			.setDesc("The radius of the cursor border (e.g. 0px, 5px)")
			.addText(text => text
				.setValue(this.plugin.settings.cursorRadius)
				.onChange(async (val) => {
					this.plugin.settings.cursorRadius = val;
					await this.plugin.saveSettings();
				})
			);

		new Setting(this.containerEl)
			.setName("Cursor Opacity")
			.setDesc("The opacity of the cursor (0-100)")
			.addText(text => text
				.setValue(this.plugin.settings.cursorOpacity)
				.onChange(async (val) => {
					this.plugin.settings.cursorOpacity = val;
					await this.plugin.saveSettings();
				})
			);
	}

	public hide(): void {
		// Clear all components when the tab was hidden.
		this.containerEl.empty();
		super.hide();
	}
}
