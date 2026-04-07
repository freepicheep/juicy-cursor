import { EditorState, Text } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { debounce, editorInfoField } from "obsidian";
import { around } from "monkey-around";
import { CursorLayerView } from "src/typings";
import { AnimatedCursorSettings } from "src/main";
import { tableCellFocusChange } from "src/observer";
import CursorMarker from "src/cursor-marker";

interface HeadingInfo {
	from: number;
	level: number;
}

const headingCache = new WeakMap<Text, readonly HeadingInfo[]>();
const headingColorProbeCache = new WeakMap<EditorView, HTMLElement>();

/**
 * Patch for update handler of cursor layer.
 */
const layerUpdaterPatch = function (update: ViewUpdate, dom: HTMLElement) {
	if (
		!update.docChanged && !update.selectionSet &&
		update.transactions.some(tr => !!tr.annotation(tableCellFocusChange))
	) return false;

	let tableCellCm = getTableCellCm(update.state);
	if (tableCellCm === update.view) return false;

	// Toggle "cm-overTableCell" class, depends on editor's focus state.
	let tableHasFocus = !update.view.hasFocus && (tableCellCm?.hasFocus ?? false);
	dom.toggleClass("cm-overTableCell", tableHasFocus);

	// Reset the blink layer.
	if (
		(update.docChanged || update.selectionSet) &&
		(update.view.hasFocus || tableHasFocus)
	) {
		dom.removeClass("cm-blinkLayer");
		// Debounce the blink.
		blinkDebouncer(dom);
		return true;
	}

	return false;
}

/**
 * Patch for marker maker of cursor layer.
 * 
 * Taken from, and modified of CodeMirror's `cursorLayer.markers`
 * version. Only be found in its internal API.
 * 
 * Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin>
 * and others at CodeMirror. Licensed under MIT.
 * 
 * @see https://github.com/codemirror/view/blob/main/src/draw-selection.ts
 */
const layerMarkersPatch = (settings: AnimatedCursorSettings) => function (view: EditorView) {
	let { state } = view,
		tableCellView: EditorView | undefined,
		cursors: CursorMarker[] = [];

	if (!view.hasFocus) tableCellView = getTableCellCm(state);
	if (tableCellView) ({ state } = tableCellView);
	if (view === tableCellView) return cursors;

	for (let range of state.selection.ranges) {
		// Primary cursor will be drawn as DOM, opposite to what Obsidian
		// implemented, so the primary is able to be animated.
		let isPrimary = range == state.selection.main,
			className = "cm-cursor " + (isPrimary ? "cm-cursor-primary" : "cm-cursor-secondary"),
			colorSourceView = tableCellView ?? view,
			cursorColor = settings.matchHeadingColor
				? resolveHeadingCursorColor(
					colorSourceView,
					state,
					range.head,
					settings.cursorColor
				)
				: undefined,
			cursorMarker = tableCellView
				? CursorMarker.forTableCellRange(view, tableCellView, className, range, settings.useTransform, settings.cursorHeight, cursorColor)
				: CursorMarker.forRange(view, className, range, settings.useTransform, settings.cursorHeight, cursorColor);

		// If the cursor is secondary and the range is not empty (is selecting),
		// we should not draw the cursor.
		if (!isPrimary && !range.empty) continue;

		if (cursorMarker)
			cursors.push(cursorMarker);
	}
	return cursors;
}

function resolveHeadingCursorColor(view: EditorView, state: EditorState, pos: number, fallbackColor: string): string {
	let activeHeading = getActiveHeading(state, pos);
	if (!activeHeading) return fallbackColor;

	let headingEl = getHeadingColorElement(view, activeHeading.level);
	if (!headingEl) return fallbackColor;

	let headingColor = getComputedStyle(headingEl).color;
	if (headingColor) return headingColor;
	return fallbackColor;
}

function getActiveHeading(state: EditorState, pos: number): HeadingInfo | undefined {
	let headings = getHeadings(state.doc);
	if (!headings.length) return;

	let currentLineFrom = state.doc.lineAt(pos).from,
		low = 0,
		high = headings.length - 1,
		activeHeadingIndex = -1;

	while (low <= high) {
		let mid = (low + high) >> 1;
		if (headings[mid].from <= currentLineFrom) {
			activeHeadingIndex = mid;
			low = mid + 1;
		} else high = mid - 1;
	}

	if (activeHeadingIndex < 0) return;
	return headings[activeHeadingIndex];
}

function getHeadings(doc: Text): readonly HeadingInfo[] {
	let cachedHeadings = headingCache.get(doc);
	if (cachedHeadings) return cachedHeadings;

	let headings: HeadingInfo[] = [],
		inFrontmatter = false,
		fenceChar: "`" | "~" | undefined,
		fenceLength = 0;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		let line = doc.line(lineNumber),
			trimmedLine = line.text.trim(),
			fenceMatch = line.text.match(/^\s{0,3}(`{3,}|~{3,})/);

		if (lineNumber === 1 && trimmedLine === "---") {
			inFrontmatter = true;
			continue;
		}

		if (inFrontmatter) {
			if (lineNumber > 1 && /^(---|\.{3})\s*$/.test(trimmedLine))
				inFrontmatter = false;
			continue;
		}

		if (fenceChar) {
			if (
				fenceMatch &&
				fenceMatch[1][0] === fenceChar &&
				fenceMatch[1].length >= fenceLength
			) {
				fenceChar = undefined;
				fenceLength = 0;
			}
			continue;
		}

		if (fenceMatch) {
			fenceChar = fenceMatch[1][0] as "`" | "~";
			fenceLength = fenceMatch[1].length;
			continue;
		}

		let headingMatch = line.text.match(/^\s{0,3}(#{1,6})(?:\s+|$)/);
		if (!headingMatch) continue;

		headings.push({
			from: line.from,
			level: headingMatch[1].length
		});
	}

	headingCache.set(doc, headings);
	return headings;
}

function getHeadingColorElement(view: EditorView, level: number): HTMLElement | null {
	let visibleHeadingEl = view.contentDOM.querySelector(
		`.HyperMD-header-${level}, .cm-header-${level}`
	);
	if (visibleHeadingEl instanceof HTMLElement) return visibleHeadingEl;

	let probe = headingColorProbeCache.get(view);
	if (!probe?.isConnected) {
		probe = createHeadingColorProbe(view);
		headingColorProbeCache.set(view, probe);
	}

	let probeHeadingEl = probe.querySelector(`.juicy-cursor-heading-probe-level-${level}`);
	return probeHeadingEl instanceof HTMLElement ? probeHeadingEl : null;
}

function createHeadingColorProbe(view: EditorView): HTMLElement {
	let probe = createDiv({
		cls: "cm-content juicy-cursor-heading-probe"
	});

	probe.ariaHidden = "true";
	probe.setCssStyles({
		position: "absolute",
		left: "0",
		top: "0",
		width: "0",
		height: "0",
		overflow: "hidden",
		opacity: "0",
		pointerEvents: "none"
	});

	for (let level = 1; level <= 6; level++) {
		let lineEl = createDiv({
			cls: `cm-line HyperMD-header HyperMD-header-${level}`
		});

		lineEl.createSpan({
			cls: `cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header cm-header-${level}`
		}, span => {
			span.textContent = `${"#".repeat(level)} `;
		});

		lineEl.createSpan({
			cls: `cm-header cm-header-${level} juicy-cursor-heading-probe-level-${level}`
		}, span => {
			span.textContent = `Heading ${level}`;
		});

		probe.appendChild(lineEl);
	}

	view.scrollDOM.appendChild(probe);
	return probe;
}

/**
 * Debounce the cursor blink by delaying its layer element from being
 * blink-animated, instead of changing its animation keyframe each layer
 * update.
 * 
 * This is according to the cursor blink mechanism in VSCode.
 */
const blinkDebouncer = debounce((layerEl: HTMLElement) => {
	layerEl.addClass("cm-blinkLayer");
}, 350, true);

/**
 * Get table cell's `EditorView` in the current editor if any.
 * 
 * @param state Associated `EditorState`.
 */
function getTableCellCm(state: EditorState): EditorView | undefined {
	let editor = state.field(editorInfoField).editor,
		{ activeCM } = editor ?? {};

	if (!editor?.inTableCell) return;

	return activeCM;
}

/**
 * Patch the cursor layer and return the uninstaller to revert the patch.
 * 
 * @returns A patch uninstaller.
 * 
 * @remark **Should not be executed again after successful hook attemp**
 */
export function patchCursorLayer(cursorPlugin: CursorLayerView, settings: AnimatedCursorSettings) {
	return around(cursorPlugin.layer, {
		// Patch the update handler.
		update: () => layerUpdaterPatch,
		// Patch the marker generator method.
		markers: () => layerMarkersPatch(settings)
	});
}
