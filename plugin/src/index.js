/*
 * CodeCogs Equation Editor plugin for CKEditor 5.
 *
 * Usage:
 *
 *   import { ClassicEditor, Essentials, Paragraph, Image } from 'ckeditor5';
 *   import { eqnEditor5 } from '@codecogs/fxeditor-ckeditor5';
 *
 *   ClassicEditor.create( document.querySelector( '#editor' ), {
 *       licenseKey: 'GPL',
 *       plugins: [ Essentials, Paragraph, Image, eqnEditor5 ],
 *       toolbar: [ 'undo', 'redo', '|', 'EqnEditor5' ],
 *       eqnEditor: { server: 'fxtex.codecogs.com' }
 *   } );
 *
 * The dialog is maths-view only: no LaTeX markup and no rendered-equation preview are visible
 * until the author asks for them (the LaTeX and Inline toggles, bottom-left of the panel).
 * Insert writes MathML directly by default - a dropdown next to those toggles switches to an
 * <img> against the SVG rendering service instead, which needs the Image plugin.
 */

import {
    Plugin, ButtonView, ContextualBalloon, DomEventObserver, clickOutsideHandler,
    submitHandler, View,
} from 'ckeditor5';

/* -------------------------------------------------------------------------------------------
 * Defaults
 * ---------------------------------------------------------------------------------------- */

// Where the editor's own code is served from: fxtex.codecogs.com, which serves the current API
// bundle, its stylesheet and its feature bundles beside it, and fxTeX Pro. editor.codecogs.com and
// latex.codecogs.com still answer but serve older builds, so neither is the default any more.
const DEFAULT_EDITOR_HOST = 'fxtex.codecogs.com';

// Where SVG equations are rendered. Separate from the host above because a customer running
// their own rendering service still wants the stock editor code.
const DEFAULT_RENDER_URL = 'https://latex.codecogs.com';

// The Equation Editor icon. Change if you wish to use different graphics.
const fxIcon = '<?xml version="1.0" encoding="utf-8"?><svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"	 width="18px" height="20px" viewBox="0 0 18 20" enable-background="new 0 0 18 20" xml:space="preserve"><rect x="4.4" y="5.1" fill="none" width="38.6" height="43.4"/><g enable-background="new"><path d="M4,9.5H2L2.3,7h2.1l0.3-1.8C4.7,4.6,4.9,4.1,5,3.6c0.2-0.5,0.4-0.9,0.7-1.3c0.3-0.4,0.8-0.7,1.3-0.9C7.7,1.1,8.4,1,9.2,1		c0.3,0,0.6,0,0.9,0c0.3,0,0.6,0.1,0.9,0.1l-0.5,2.7c-0.2-0.1-0.3-0.1-0.5-0.2c-0.1,0-0.3-0.1-0.5-0.1C9,3.7,8.6,3.8,8.4,4		C8.1,4.2,7.9,4.7,7.8,5.4L7.6,7h2.3L9.5,9.5H7.2l-1.1,7.7H3L4,9.5z"/></g><g enable-background="new">	<path d="M11.1,15.3l-2.3-3.2h2.5l1.2,1.8l1.2-1.8H16l-2.2,3.2l2.6,3.6h-2.5l-1.5-2.3L10.8,19H8.4L11.1,15.3z"/></g></svg>';

/* -------------------------------------------------------------------------------------------
 * Loading the Equation Editor's own code
 * ----------------------------------------------------------------------------------------
 * The API bundle is fetched from CodeCogs rather than bundled, so a customer always gets the
 * current editor without rebuilding. That makes it asynchronous, and the previous version
 * simply appended a <script> tag and then assumed `EqEditor` existed by the time the toolbar
 * button was pressed - which is true if you take a second to click, and a ReferenceError if
 * you do not. Everything now waits on this promise instead.
 *
 * The promise is cached per URL, so several editors on one page share a single download.
 */
const scriptPromises = new Map();

function loadScriptOnce( url ) {
    if ( scriptPromises.has( url ) ) {
        return scriptPromises.get( url );
    }

    const promise = new Promise( ( resolve, reject ) => {
        // Another plugin instance (or the host page) may have loaded it already.
        if ( typeof window.EqEditor !== 'undefined' ) {
            resolve();
            return;
        }

        const existing = document.querySelector( `script[src="${ url }"]` );
        const script = existing || document.createElement( 'script' );

        script.addEventListener( 'load', () => resolve() );
        script.addEventListener( 'error', () => reject(
            new Error( `CodeCogs Equation Editor: could not load ${ url }` ) ) );

        if ( !existing ) {
            script.src = url;
            script.type = 'text/javascript';
            document.head.appendChild( script );
        }
    } );

    scriptPromises.set( url, promise );
    return promise;
}

// EqEditor.init() switches the converter every TextArea/MathView/Toolbar construction takes on
// to fxTeX Pro - skip it and they keep the placeholder converter for their whole lifetime, even
// once fxeditor.api.min.js itself has loaded. Called once per page; an empty licence is the
// normal, expected state until a real one is configured.
let initPromise = null;

function ensureInit( licence ) {
    if ( initPromise ) {
        return initPromise;
    }
    initPromise = ( typeof window.EqEditor.init === 'function' )
        ? window.EqEditor.init( { licence: licence || '' } ).catch( err => {
            window.console && console.warn( `fxTeX Pro: ${ err && err.message || err }` );
        } )
        : Promise.resolve();
    return initPromise;
}

function loadCssOnce( url ) {
    if ( document.querySelector( `link[href="${ url }"]` ) ) {
        return;
    }
    const link = document.createElement( 'link' );
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild( link );
}

// Gaps in the shared fxeditor.css (loaded separately, asynchronously, from the configured
// host) this panel needs but can't assume it will get:
//  - editor.codecogs.com, the old default host and still configurable, serves an older stylesheet that predates
//    the CCEqnEditor/CCMathViewHost/CCLatexInput class names entirely (only a local dev mirror
//    does not have this gap), so the LaTeX/maths mutual-exclusion below is written defensively
//    rather than left to fxeditor.css;
//  - this is a balloon, not a dialog, so by default it sizes to fit its content - CKEditor's
//    own .ck-balloon-panel has no opinion on how big an 850px-wide, mostly-empty maths view
//    should be, so this gives it one;
//  - there is no rendered-equation preview and no LaTeX box visible by default (see
//    EqnEditorView's template), so the maths view needs to fill the space between the toolbar
//    and the bottom bar itself.
// Injected once, since it would otherwise race fxeditor.css over which rule wins.
// The API's own injected @font-face for "Latin Modern Math" only carries
// local("Latin Modern Math") - no url() fallback - so it silently falls back to a generic
// serif unless that exact font happens to be installed. A later @font-face for the same
// family replaces the API's src list rather than merging with it, so redeclaring it here
// with a real url() fixes every equation and symbol on the page, not just this balloon's.
function injectStyleOverridesOnce( fontUrl ) {
    if ( document.getElementById( 'cc-eqneditor-style-overrides' ) ) {
        return;
    }
    const style = document.createElement( 'style' );
    style.id = 'cc-eqneditor-style-overrides';
    style.textContent =
        `@font-face { font-family: "Latin Modern Math"; font-display: swap; ` +
            `src: local("Latin Modern Math"), url("${ fontUrl.replace( /prototypes\/latinmodern-math\.otf$/, 'fonts/LatinModernMath-Regular.woff2' ) }") format("woff2"), url("${ fontUrl }") format("opentype"); }` +
        // Undo host resets (e.g. .cke_reset_all *) inside the toolbar icons and the maths view's MathML.
        '.CCToolbar svg:has(g[font-family]), .CCToolbar svg:has(g[font-family]) * { font: revert-layer !important; }' +
        // Icons drawn as <text>: the svg gets the API's own .cc_panel font (fxTeX Toolbar, 16px) back over host resets, and each <text> its own font-size attribute (revert-layer lets attributes win).
        '.CCToolbar svg:not(:has(g[font-family])) { font: normal normal 16px "fxTeX Toolbar" !important; }' +
        '.CCToolbar svg:not(:has(g[font-family])) * { font: revert-layer !important; }' +
        '.CCToolbar svg, .CCToolbar svg * { width: revert-layer !important; height: revert-layer !important; max-width: revert-layer !important; }' +
        '.CCToolbar svg g[font-family="fxTeX Toolbar"] { color: #000 !important; }' +
        '.CCMathView math, .CCMathView math * { font: revert-layer !important; ' +
            'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; ' +
            'margin: revert-layer !important; text-transform: revert-layer !important; text-align: revert-layer !important; ' +
            'box-sizing: revert-layer !important; white-space: revert-layer !important; }' +
        apiMathRules() +
        '.ck-balloon-panel:has(.CCEqnEditor) { width: 850px !important; max-width: 96vw !important; }' +
        // nowrap: CKEditor's own form styles wrap, and a wrapping flex column is as wide as its widest
        // item - the toolbar's whole row - so the editor ran past a narrow balloon (`design.width`).
        '.ck-eqneditor-form { display: flex !important; flex-direction: column !important; flex-wrap: nowrap !important; padding: 12px 14px !important; }' +
        '.CCEqnEditor { display: flex !important; flex-direction: column !important; ' +
            'height: 480px !important; flex: 1 1 auto !important; }' +
        '.CCEqnEditor .CCEditorBar { flex: 0 0 auto; }' +
        // The toolbar as wide as the dialog, no wider: sized to its own content instead (width: auto)
        // it kept the toolbar's whole row and ran past a narrow dialog (`design.width`); at 100% the
        // toolbar scrolls.
        '.CCEqnEditor [id^="cc-eqn-toolbar-"] { align-self: flex-start; width: 100%; }' +
        '.CCEqnEditor .CCMathViewHost { ' +
            'flex: 1 1 auto; min-height: 0; display: flex; align-items: center; ' +
            'justify-content: center; overflow: auto; }' +
        '.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start; }' +
        '.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
        '.CCEqnEditor .CCLatexInput { flex: 1 1 auto; min-height: 0; overflow: auto; }' +
        '.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
        '.CCEqnEditor .CCEqnOutput-hidden { display: none !important; }' +
        // The bottom bar: toggles left, Insert-as and the dialog's buttons right, one type size. All !important - host dialog resets otherwise restyle it.
        '.cc-eqn-bar { display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
            'margin: 8px 0 0 !important; padding: 10px 0 0 !important; border: 0 !important; border-top: 1px solid #e2e8f0 !important; ' +
            'background: none !important; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important; color: #1c2530 !important; }' +
        '.cc-eqn-bar-right { display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 0 0 auto !important; padding: 0 !important; font: inherit !important; color: inherit !important; }' +
        '.cc-eqn-bar .cc-switch { display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 !important; ' +
            'padding: 0 !important; font: inherit !important; color: #54647c !important; cursor: pointer !important; user-select: none !important; white-space: nowrap !important; }' +
        '.cc-eqn-bar .cc-switch input { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; ' +
            'padding: 0 !important; border: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; opacity: 0 !important; }' +
        '.cc-eqn-bar .cc-switch-track { position: relative !important; display: inline-block !important; flex: 0 0 auto !important; width: 28px !important; ' +
            'height: 16px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; ' +
            'background: #ccc !important; transition: background .2s !important; }' +
        '.cc-eqn-bar .cc-switch-knob { position: absolute !important; display: block !important; top: 2px !important; left: 2px !important; ' +
            'width: 12px !important; height: 12px !important; margin: 0 !important; border-radius: 50% !important; background: #fff !important; transition: left .2s !important; }' +
        '.cc-eqn-bar .cc-switch input:checked + .cc-switch-track { background: #4caf50 !important; }' +
        '.cc-eqn-bar .cc-switch input:checked + .cc-switch-track .cc-switch-knob { left: 14px !important; }' +
        '.cc-eqn-bar .cc-switch input:focus-visible + .cc-switch-track { outline: 2px solid #003794 !important; outline-offset: 2px !important; }' +
        '.cc-eqn-bar .cc-switch input:disabled ~ * { opacity: .5 !important; cursor: default !important; }' +
        '.cc-eqn-bar .cc-switch-label { font: inherit !important; color: inherit !important; }' +
        '.cc-eqn-bar .cc-switch input:checked ~ .cc-switch-label { color: #003794 !important; font-weight: 600 !important; }' +
        '.cc-eqn-bar .cc-eqn-select { width: auto !important; height: 30px !important; margin: 0 !important; padding: 0 8px !important; ' +
            'border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; font: inherit !important; color: #1c2530 !important; cursor: pointer !important; }' +
        '.cc-eqn-bar .cc-eqn-btn { display: inline-flex !important; align-items: center !important; height: 30px !important; margin: 0 !important; ' +
            'padding: 0 16px !important; border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; ' +
            'font: inherit !important; color: #1c2530 !important; cursor: pointer !important; box-shadow: none !important; }' +
        '.cc-eqn-bar .cc-eqn-btn * { font: inherit !important; color: inherit !important; }' +
        '.cc-eqn-bar .cc-eqn-btn.cc-eqn-primary { background: #2c7a4b !important; border-color: #2c7a4b !important; color: #fff !important; }' +
        // fxeditor.css caps this at min(760px, 92vw), which left it hard against the left of the 850px balloon.
        '.ck-eqneditor-form .CCEqnEditor { width: auto !important; align-self: stretch !important; }';
    document.head.appendChild( style );
}

// Re-asserts the API's own .CCMathView/.fxtex rules, which host resets and revert-layer override.
// The `design` option (see the README): how the editor looks, set by the site rather than the
// author. The toolbar's rows and scale go to Toolbar.link() itself; everything else is applied
// here, once the editor is mounted - CSS scoped to this editor's root, then the starting state of
// the LaTeX toggle and the "Insert as" menu.
// The dialog's size when the design does not set one: about 700 by 450 pixels.
var DEFAULT_WIDTH = 700, DEFAULT_HEIGHT = 450;
function designWidth( design ) { return Number( design && design.width ) > 0 ? Number( design.width ) : DEFAULT_WIDTH; }
function designHeight( design ) { return Number( design && design.height ) > 0 ? Number( design.height ) : DEFAULT_HEIGHT; }
var designCount = 0;
function applyDesign( root, design, latexToggle, insertSelect ) {
    if ( !root || !design ) return;
    if ( !root.id ) root.id = 'cc-eqn-design-' + ( ++designCount );
    var sel = '#' + root.id, css = '';
    var colour = String( design.colour || '' );
    if ( /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test( colour ) ) {
        css += sel + ' { --cc-accent: ' + colour + ';' +
            ' --cc-accent-soft: color-mix(in srgb, ' + colour + ' 11%, #fff);' +
            ' --cc-accent-soft-ring: color-mix(in srgb, ' + colour + ' 28%, #fff);' +
            ' --cc-accent-mid: color-mix(in srgb, ' + colour + ' 22%, #fff);' +
            ' --cc-accent-mid-ring: color-mix(in srgb, ' + colour + ' 43%, #fff); }';
    }
    if ( Number( design.mathSize ) > 0 ) css += sel + ' .CCMathView { font-size: ' + Number( design.mathSize ) + 'px !important; }';
    if ( Number( design.latexSize ) > 0 ) css += sel + ' .CCLatexInput { font-size: ' + Number( design.latexSize ) + 'px !important; }';
    if ( design.toolbar === false ) css += sel + ' .CCToolbar { display: none !important; }';
    if ( design.history === false ) css += sel + ' .CCEditorBar { display: none !important; }';
    if ( css ) {
        var style = document.createElement( 'style' );
        style.textContent = css;
        root.appendChild( style );
    }
    // The dialog's width and height (`width`, `height`), before any scaling: the box takes the width,
    // and the editing area whatever height makes the whole dialog the height asked for - measured,
    // since everything else in it (toolbar rows, the bottom bar) varies with the design. Hosts that
    // size their dialogs themselves (TinyMCE 4, CKEditor 4) are given both when they open it instead.
    var sizedBox = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
    if ( !sizedBox.matches( '.mce-window, .cke_dialog' ) ) {
        sizedBox.style.setProperty( 'width', designWidth( design ) + 'px', 'important' );
        var area = root.querySelector( '.CCMathViewHost' );
        if ( area ) {
            // Measured, then measured again as the dialog settles - the toolbar fits itself to its row
            // after the dialog first lays out, and the fonts arrive - correcting by the difference each time.
            // A box with a height of its own (Froala's and Tiptap's modals) sizes to its contents instead.
            sizedBox.style.setProperty( 'height', 'auto', 'important' );
            var sizing = document.createElement( 'style' );
            root.appendChild( sizing );
            var h = 0;
            var fit = function () {
                var shown = root.querySelector( '.CCLatexInput' ) && getComputedStyle( area ).display === 'none'
                    ? root.querySelector( '.CCLatexInput' ) : area;
                // Scale may already be applied (see below), and on-screen sizes include it.
                var applied = parseFloat( sizedBox.style.zoom ) || parseFloat( ( sizedBox.style.transform.match( /scale\(([\d.]+)\)/ ) || [] )[ 1 ] ) || 1;
                var now = h || shown.getBoundingClientRect().height / applied;
                h = Math.max( 120, Math.round( now + designHeight( design ) - sizedBox.getBoundingClientRect().height / applied ) );
                // Never taller than the whole dialog asked for: a host that caps its dialog (and scrolls the
                // rest) would otherwise be chased upwards on every pass.
                h = Math.min( h, designHeight( design ) );
                sizing.textContent = '#' + root.id + ' { height: auto !important; } #' + root.id + ' .CCMathViewHost, #' + root.id + ' .CCLatexInput { height: ' + h + 'px !important; min-height: ' + h + 'px !important; }';
            };
            fit();
            [ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( fit, t ); } );
        }
    }
    // The whole dialog, box and contents together - see `dialogSize` in the README. Zoomed where
    // the host lays the dialog out (it grows in place); scaled where the host positions it itself
    // (CKEditor, TinyMCE 4, a TiddlyWiki drop-down), so that placement still holds.
    var size = Number( design.dialogSize );
    if ( size > 0 && size !== 1 ) {
        var box = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
        var position = getComputedStyle( box ).position;
        if ( position === 'absolute' || position === 'fixed' ) {
            box.style.transform = 'scale(' + size + ')';
            box.style.transformOrigin = box.matches( '.ck-balloon-panel' ) ? 'top center'
                : box.matches( '.tc-drop-down' ) ? 'top left' : 'center center';
            // A cap on the box's width (CKEditor 5's balloon: 96vw) holds before the scale - divided by it,
            // as for zoom below, or a scaled-down box is squeezed narrower than its own contents.
            box.style.removeProperty( 'max-width' );   // a host that reuses the box (CKEditor 5) would otherwise divide it again
            var cap = getComputedStyle( box ).maxWidth;
            if ( cap !== 'none' ) box.style.setProperty( 'max-width', 'calc(' + cap + ' / ' + size + ')', 'important' );
        } else {
            box.style.zoom = String( size );
            box.style.setProperty( 'max-width', 'calc(96vw / ' + size + ')', 'important' );   // still no wider than the window
        }
    }
    if ( insertSelect && design.insertAs && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
        insertSelect.value = design.insertAs;
    }
    if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
        latexToggle.checked = true;
        latexToggle.dispatchEvent( new Event( 'change', { bubbles: true } ) );
    }
}

// The equation as an image URL ('url') or as MathML ('mathml'). fxeditor-api replaced Output.exportAs()
// with getEquationURL() and setFormat()/setWrapper()/getCode() (its 9630657); exportAs() still serves an
// API from before that. The format is set each time: the same Output gives both.
function outputCode( output, kind ) {
    if ( typeof output.exportAs === 'function' ) return output.exportAs( kind );
    if ( kind === 'mathml' ) return output.setFormat( 'mathml' ).setWrapper( 'html' ).getCode();
    return output.setFormat( 'svg' ).getEquationURL();
}

// The editor's own controls, as the Google Docs sidebar has them: the toolbar's size (50-120%) at the
// right of the undo/redo bar; Inline, LaTeX and Predictor switches together - Inline added where a
// host has none, Predictor beside LaTeX; and LaTeX shown above the maths view rather than in its place
// (see stackPanes()). The size, Inline, LaTeX, Predictor and the markup's height are remembered here;
// the predictor starts as design.predictor says until the author has chosen. `parts` carries the
// editor's textArea, mathView and output, and the latexToggle and inlineToggle checkboxes.
var EDITOR_PREFS_KEY = 'cc-eqn-editor';
function addEditorControls( root, design, parts ) {
    if ( !root || !parts ) return;
    design = design || {};
    injectPredictorStylesOnce();
    var prefs = {};
    try { prefs = JSON.parse( localStorage.getItem( EDITOR_PREFS_KEY ) ) || {}; } catch ( e ) {}
    var save = function () {
        try { localStorage.setItem( EDITOR_PREFS_KEY, JSON.stringify( prefs ) ); } catch ( e ) {}
    };
    var latexLabel = parts.latexToggle && parts.latexToggle.closest( 'label' );
    // Another switch drawn exactly as the LaTeX one is - whatever markup and styling this host gives it.
    var makeSwitch = function ( text, title ) {
        var label = latexLabel.cloneNode( true );
        var input = label.querySelector( 'input' );
        input.removeAttribute( 'id' );
        input.className = '';
        for ( var i = input.attributes.length - 1; i >= 0; i-- ) {
            if ( /^data-/.test( input.attributes[ i ].name ) ) input.removeAttribute( input.attributes[ i ].name );
        }
        input.checked = false;
        input.disabled = false;
        label.removeAttribute( 'for' );
        label.title = title;
        var name = label.querySelector( '.cc-switch-label' );
        if ( name ) name.textContent = text;
        return label;
    };

    // The toolbar's size. zoom scales it as it stands, so nothing is rebuilt: it keeps which pane it
    // types into, and any panel that is open.
    var toolbar = root.querySelector( '.CCToolbar' ), bar = root.querySelector( '.CCEditorBar' );
    if ( toolbar && bar && design.toolbar !== false && !bar.querySelector( '.cc-toolbar-size' ) ) {
        var size = document.createElement( 'label' );
        size.className = 'cc-toolbar-size';
        size.title = 'The toolbar’s size';
        size.innerHTML = '<input type="range" min="50" max="120" step="5" aria-label="Toolbar size"><output></output>';
        bar.appendChild( size );
        var range = size.querySelector( 'input' ), shown = size.querySelector( 'output' );
        var setSize = function ( pct ) {
            pct = Math.min( 120, Math.max( 50, Math.round( Number( pct ) / 5 ) * 5 || 100 ) );
            prefs.toolbarSize = pct;
            toolbar.style.zoom = String( pct / 100 );
            range.value = pct;
            shown.textContent = pct + '%';
        };
        setSize( prefs.toolbarSize || 100 );
        range.addEventListener( 'input', function () { setSize( range.value ); } );
        range.addEventListener( 'change', save );
    }

    // Inline: the host's own switch, or one added before LaTeX where it has none.
    var inline = parts.inlineToggle;
    if ( !inline && latexLabel ) {
        var inlineLabel = makeSwitch( 'Inline', 'An inline equation, set to sit in a line of text' );
        latexLabel.parentNode.insertBefore( inlineLabel, latexLabel );
        inline = inlineLabel.querySelector( 'input' );
        inline.addEventListener( 'change', function () {
            root.setAttribute( 'data-inline', inline.checked ? 'on' : 'off' );
            if ( parts.mathView && parts.mathView.setInline ) parts.mathView.setInline( inline.checked );
            if ( parts.output && parts.output.setInline ) parts.output.setInline( inline.checked );
        } );
    }
    if ( inline ) {
        if ( typeof prefs.inline === 'boolean' && inline.checked !== prefs.inline && !inline.disabled ) {
            inline.checked = prefs.inline;
            inline.dispatchEvent( new Event( 'change', { bubbles: true } ) );
        }
        inline.addEventListener( 'change', function () { prefs.inline = inline.checked; save(); } );
    }

    // LaTeX: remembered with the rest (a host that keeps its own record is overruled by this one).
    var latex = parts.latexToggle;
    if ( latex ) {
        if ( typeof prefs.latex === 'boolean' && latex.checked !== prefs.latex && !latex.disabled ) {
            latex.checked = prefs.latex;
            latex.dispatchEvent( new Event( 'change', { bubbles: true } ) );
        }
        latex.addEventListener( 'change', function () { prefs.latex = latex.checked; save(); } );
    }

    stackPanes( root, prefs, save );

    // The predictor, switched on and off beside LaTeX.
    if ( latexLabel ) {
        var predictorBox = null;
        var predictor = addPredictor( root, design, parts.textArea, parts.mathView, function () {
            predictorBox.checked = false;
            prefs.predictor = false;
            save();
        } );
        if ( predictor ) {
            var predictorLabel = makeSwitch( 'Predictor', 'Suggested equations, as you write' );
            latexLabel.parentNode.insertBefore( predictorLabel, latexLabel.nextSibling );
            predictorBox = predictorLabel.querySelector( 'input' );
            predictorBox.checked = typeof prefs.predictor === 'boolean' ? prefs.predictor : !!design.predictor;
            predictor.setOn( predictorBox.checked );
            predictorBox.addEventListener( 'change', function () {
                predictor.setOn( predictorBox.checked );
                prefs.predictor = predictorBox.checked;
                save();
            } );
        }
    }
}

// The LaTeX markup above the maths view while LaTeX is on, rather than in its place, with a bar
// between them that drags (or arrow-keys) the markup taller or shorter - its height remembered as
// prefs.latexHeight. Follows the editor root's data-latex, which every host's LaTeX switch sets, and
// overrides the host's own rule hiding the maths view meanwhile (inline and !important, as that is).
var LATEX_HEIGHT = 90, LATEX_MIN = 40;
function stackPanes( root, prefs, save ) {
    var host = root.querySelector( '.CCMathViewHost' ), markup = root.querySelector( '.CCLatexInput' );
    if ( !host || !markup || root.querySelector( '.cc-eqn-panes' ) ) return;
    var panes = document.createElement( 'div' );
    panes.className = 'cc-eqn-panes';
    var first = ( markup.compareDocumentPosition( host ) & 4 ) ? markup : host;   // 4: host follows markup
    first.parentNode.insertBefore( panes, first );
    var grip = document.createElement( 'div' );
    grip.className = 'cc-eqn-panes-split';
    grip.tabIndex = 0;
    grip.setAttribute( 'role', 'separator' );
    grip.setAttribute( 'aria-orientation', 'horizontal' );
    grip.setAttribute( 'aria-label', 'Resize the LaTeX markup' );
    grip.title = 'Drag to share the space between the LaTeX and the equation';
    panes.appendChild( markup );
    panes.appendChild( grip );
    panes.appendChild( host );

    var height = Number( prefs.latexHeight ) >= LATEX_MIN ? Number( prefs.latexHeight ) : LATEX_HEIGHT;
    var set = function ( el, prop, value ) { el.style.setProperty( prop, value, 'important' ); };
    // A host that shows one pane at a time gives the editing area's height to whichever is showing:
    // with both showing, that area is shared - the markup's height, then the bar, then the equation
    // whatever is left. A host that shows both anyway sizes them itself; the markup's height is set.
    var apply = function () {
        var both = root.getAttribute( 'data-latex' ) === 'on';
        panes.classList.toggle( 'cc-eqn-both', both );
        [ 'height', 'min-height', 'flex', 'display' ].forEach( function ( p ) {
            markup.style.removeProperty( p );
            host.style.removeProperty( p );
        } );
        if ( !both ) return;
        set( markup, 'min-height', '0' );
        set( markup, 'flex', '0 0 auto' );
        if ( getComputedStyle( host ).display !== 'none' ) {
            set( markup, 'height', height + 'px' );
            return;
        }
        var area = markup.offsetHeight;   // what the host gives the markup alone: the whole area
        if ( !area ) return;              // not laid out yet - the ResizeObserver below comes back
        var bar = grip.offsetHeight + 2;
        var h = Math.min( height, Math.max( LATEX_MIN, area - bar - 60 ) );
        set( markup, 'height', h + 'px' );
        set( host, 'display', 'flex' );
        set( host, 'height', Math.max( 0, area - bar - h ) + 'px' );
        set( host, 'min-height', '0' );
        set( host, 'flex', '0 0 auto' );
    };
    var setHeight = function ( h ) {
        height = Math.round( Math.max( LATEX_MIN, h ) );
        apply();
    };
    apply();
    new MutationObserver( apply ).observe( root, { attributes: true, attributeFilter: [ 'data-latex' ] } );
    // The dialog lays out, or is resized, after this has run (TinyMCE 4's and WordPress's settle their
    // sizes a moment later): share the area it then has. The editor's root, not the panes, is watched -
    // the panes take the heights set here, so would not change to say so - and measured again as the
    // dialog settles, as applyDesign() measures its height.
    var again = function () { if ( panes.classList.contains( 'cc-eqn-both' ) ) apply(); };
    if ( typeof ResizeObserver !== 'undefined' ) new ResizeObserver( again ).observe( root );
    [ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( again, t ); } );

    grip.addEventListener( 'keydown', function ( e ) {
        if ( e.key !== 'ArrowUp' && e.key !== 'ArrowDown' ) return;
        e.preventDefault();
        setHeight( height + ( e.key === 'ArrowDown' ? 20 : -20 ) );
        prefs.latexHeight = height;
        save();
    } );
    grip.addEventListener( 'pointerdown', function ( e ) {
        if ( e.button !== 0 ) return;
        e.preventDefault();
        var scale = panes.getBoundingClientRect().height / ( panes.offsetHeight || 1 ) || 1;
        var startY = e.clientY, startH = height;
        grip.setPointerCapture( e.pointerId );
        grip.classList.add( 'is-dragging' );
        var move = function ( ev ) { setHeight( startH + ( ev.clientY - startY ) / scale ); };
        var up = function () {
            grip.removeEventListener( 'pointermove', move );
            grip.removeEventListener( 'pointerup', up );
            grip.removeEventListener( 'pointercancel', up );
            grip.classList.remove( 'is-dragging' );
            prefs.latexHeight = height;
            save();
        };
        grip.addEventListener( 'pointermove', move );
        grip.addEventListener( 'pointerup', up );
        grip.addEventListener( 'pointercancel', up );
    } );
}

// The predictor: whole equations that start the way this one does - the API's PredictorView - in a
// panel beside the editing area. The maths view and the markup pane share one row with it, so it sits
// beside whichever is showing - or, when that row is too narrow to share (a narrow dialog), below it.
// The bar between them drags to resize the panel (arrow keys too); its button, or Enter, switches the
// predictor off, as the Predictor switch does (`onOff`). Its width beside and its height below are
// remembered in this browser. Returns { setOn }, or null for an API without a PredictorView.
var PREDICTOR_WIDTH = 220, PREDICTOR_MIN = 140, PREDICTOR_HEIGHT = 170, PREDICTOR_MIN_HEIGHT = 90;
var PREDICTOR_STACK_BELOW = 480, PREDICTOR_KEY = 'cc-eqn-predictor';
function addPredictor( root, design, textArea, mathView, onOff ) {
    if ( !root || typeof EqEditor === 'undefined' || !EqEditor.PredictorView ) return null;
    var host = root.querySelector( '.CCMathViewHost' ), markup = root.querySelector( '.CCLatexInput' );
    var panes = root.querySelector( '.cc-eqn-panes' );   // stackPanes()'s, where it has run
    var first = panes || host || markup;
    if ( !first || root.querySelector( '.cc-eqn-work' ) ) return null;
    injectPredictorStylesOnce();

    var saved = {};
    try { saved = JSON.parse( localStorage.getItem( PREDICTOR_KEY ) ) || {}; } catch ( e ) {}
    var width = Number( saved.width ) >= PREDICTOR_MIN ? Number( saved.width ) : PREDICTOR_WIDTH;
    var height = Number( saved.height ) >= PREDICTOR_MIN_HEIGHT ? Number( saved.height ) : PREDICTOR_HEIGHT;

    var work = document.createElement( 'div' );
    work.className = 'cc-eqn-work cc-eqn-predictor-off';
    first.parentNode.insertBefore( work, first );
    if ( !panes ) {
        panes = document.createElement( 'div' );
        panes.className = 'cc-eqn-panes';
        if ( markup ) panes.appendChild( markup );
        if ( host ) panes.appendChild( host );
    }

    var bar = document.createElement( 'div' );
    bar.className = 'cc-eqn-split';
    bar.tabIndex = 0;
    bar.setAttribute( 'role', 'separator' );
    bar.setAttribute( 'aria-label', 'Resize the suggested equations' );
    var fold = document.createElement( 'button' );
    fold.type = 'button';
    fold.className = 'cc-eqn-split-fold';
    fold.title = 'Hide suggested equations';
    bar.appendChild( fold );

    var side = document.createElement( 'aside' );
    side.className = 'cc-eqn-predictor';
    side.id = root.id + '-predictor';
    side.setAttribute( 'aria-label', 'Suggested equations' );

    work.appendChild( panes );
    work.appendChild( bar );
    work.appendChild( side );

    function stacked() { return work.classList.contains( 'cc-eqn-stacked' ); }
    function remember() {
        try { localStorage.setItem( PREDICTOR_KEY, JSON.stringify( { width: width, height: height } ) ); } catch ( e ) {}
    }
    function setWidth( w ) {
        // Never so wide that the editing area beside it has nothing left.
        var room = work.clientWidth - bar.offsetWidth - 160;
        width = Math.round( Math.max( PREDICTOR_MIN, room > PREDICTOR_MIN ? Math.min( w, room ) : w ) );
        side.style.width = width + 'px';
    }
    function setHeight( h ) {
        height = Math.round( Math.min( 600, Math.max( PREDICTOR_MIN_HEIGHT, h ) ) );
        side.style.height = height + 'px';
    }
    // Beside the editing area, or below it once the row is too narrow for both: measured rather than
    // decided per host, so a dialog made narrow gets the right one. The button points the way the
    // panel goes to hide.
    function layout() {
        var below = work.clientWidth > 0 && work.clientWidth < PREDICTOR_STACK_BELOW;
        work.classList.toggle( 'cc-eqn-stacked', below );
        side.style.width = below ? '' : width + 'px';
        side.style.height = below ? height + 'px' : '';
        fold.textContent = below ? '▾' : '›';
        bar.setAttribute( 'aria-orientation', below ? 'horizontal' : 'vertical' );
    }
    layout();
    if ( typeof ResizeObserver !== 'undefined' ) new ResizeObserver( function () {
        if ( stacked() !== ( work.clientWidth > 0 && work.clientWidth < PREDICTOR_STACK_BELOW ) ) layout();
    } ).observe( work );

    function off() {
        setOn( false );
        if ( onOff ) onOff();
    }
    fold.addEventListener( 'click', off );
    bar.addEventListener( 'keydown', function ( e ) {
        if ( e.target !== bar ) return;
        if ( e.key === 'Enter' || e.key === ' ' ) {
            e.preventDefault(); off();
        } else if ( !stacked() && ( e.key === 'ArrowLeft' || e.key === 'ArrowRight' ) ) {
            e.preventDefault(); setWidth( width + ( e.key === 'ArrowLeft' ? 20 : -20 ) ); remember();
        } else if ( stacked() && ( e.key === 'ArrowUp' || e.key === 'ArrowDown' ) ) {
            e.preventDefault(); setHeight( height + ( e.key === 'ArrowUp' ? 20 : -20 ) ); remember();
        }
    } );
    // Dragged from anywhere on the bar but its button: left and right beside the editing area, up
    // and down below it. Pointer movement is in screen pixels, which a scaled dialog
    // (design.dialogSize) does not share with the panel's own size - hence the ratio.
    bar.addEventListener( 'pointerdown', function ( e ) {
        if ( e.target === fold || e.button !== 0 ) return;
        e.preventDefault();
        var below = stacked();
        var scale = work.getBoundingClientRect().width / ( work.offsetWidth || 1 ) || 1;
        var start = below ? e.clientY : e.clientX;
        var size = below ? height : width;
        bar.setPointerCapture( e.pointerId );
        work.classList.add( 'cc-eqn-dragging' );
        function move( ev ) {
            if ( below ) setHeight( size + ( start - ev.clientY ) / scale );
            else setWidth( size + ( start - ev.clientX ) / scale );
        }
        function up() {
            bar.removeEventListener( 'pointermove', move );
            bar.removeEventListener( 'pointerup', up );
            bar.removeEventListener( 'pointercancel', up );
            work.classList.remove( 'cc-eqn-dragging' );
            remember();
        }
        bar.addEventListener( 'pointermove', move );
        bar.addEventListener( 'pointerup', up );
        bar.addEventListener( 'pointercancel', up );
    } );

    // Built the first time it is switched on, so nothing is asked of the suggestion service while
    // the predictor is off.
    var view = null;
    function setOn( on ) {
        work.classList.toggle( 'cc-eqn-predictor-off', !on );
        if ( !on ) return;
        layout();
        if ( !view ) {
            var show = design && ( design.predictorShow === 'latex' || design.predictorShow === 'both' ) ? design.predictorShow : 'mathml';
            view = EqEditor.PredictorView.link( side.id, { limit: 6, show: show } ).addTextArea( textArea );
            if ( mathView ) view.addMathView( mathView );
        }
    }
    return { setOn: setOn };
}

// !important throughout: hosts reset their dialogs' contents (TinyMCE's .tox, CKEditor's
// .ck-reset_all) more specifically than a plain class rule reaches.
function injectPredictorStylesOnce() {
    if ( document.getElementById( 'cc-eqn-predictor-css' ) ) return;
    var style = document.createElement( 'style' );
    style.id = 'cc-eqn-predictor-css';
    style.textContent =
        // The toolbar's size, at the right of the undo/redo bar - on one line with it however narrow.
        '.CCEditorBar:has(.cc-toolbar-size), .CCEditorBar:has(.cc-toolbar-size) .CCHistory { flex-wrap: nowrap !important; }' +
        '.cc-toolbar-size { display: inline-flex !important; align-items: center !important; gap: 4px !important; margin: 0 0 0 auto !important; ' +
            'min-width: 0 !important; flex: 0 1 auto !important; font: 11px/1 sans-serif !important; color: #54647c !important; cursor: pointer !important; }' +
        '.cc-toolbar-size input { width: 72px !important; min-width: 36px !important; flex: 0 1 72px !important; margin: 0 !important; padding: 0 !important; ' +
            'accent-color: var(--cc-accent, #003794) !important; }' +
        '.cc-toolbar-size output { min-width: 3em !important; text-align: right !important; }' +
        // The bar between the LaTeX markup and the maths view, while both show (stackPanes()).
        '.cc-eqn-panes-split { display: none !important; }' +
        '.cc-eqn-both > .cc-eqn-panes-split { display: block !important; flex: 0 0 auto !important; height: 9px !important; margin: 1px 0 !important; ' +
            'position: relative !important; cursor: row-resize !important; touch-action: none !important; outline: none !important; background: transparent !important; }' +
        '.cc-eqn-both > .cc-eqn-panes-split::before { content: "" !important; position: absolute !important; top: 3px !important; left: 42% !important; right: 42% !important; ' +
            'height: 3px !important; border-radius: 2px !important; background: #cbd5e0 !important; }' +
        '.cc-eqn-both > .cc-eqn-panes-split:hover::before, .cc-eqn-both > .cc-eqn-panes-split:focus-visible::before, .cc-eqn-panes-split.is-dragging::before { ' +
            'left: 0 !important; right: 0 !important; background: var(--cc-accent, #003794) !important; }' +
        '.cc-eqn-work { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; min-width: 0 !important; align-items: stretch !important; }' +
        '.cc-eqn-panes { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-width: 0 !important; min-height: 0 !important; }' +
        '.cc-eqn-predictor-off .cc-eqn-split, .cc-eqn-predictor-off .cc-eqn-predictor { display: none !important; }' +
        '.cc-eqn-split { flex: 0 0 auto !important; width: 9px !important; margin: 0 2px !important; cursor: col-resize !important; ' +
            'display: flex !important; align-items: center !important; justify-content: center !important; position: relative !important; ' +
            'background: transparent !important; touch-action: none !important; user-select: none !important; outline: none !important; }' +
        '.cc-eqn-split::before { content: "" !important; position: absolute !important; top: 0 !important; bottom: 0 !important; left: 4px !important; ' +
            'width: 1px !important; background: #d5dbe3 !important; }' +
        '.cc-eqn-split:hover::before, .cc-eqn-split:focus-visible::before, .cc-eqn-dragging .cc-eqn-split::before { left: 3px !important; width: 3px !important; background: var(--cc-accent, #003794) !important; }' +
        '.cc-eqn-split-fold { flex: 0 0 auto !important; position: relative !important; z-index: 1 !important; width: 16px !important; height: 34px !important; margin: 0 !important; padding: 0 !important; ' +
            'border: 1px solid #cbd5e0 !important; border-radius: 8px !important; background: #fff !important; color: #52606d !important; ' +
            'font: 14px/1 sans-serif !important; cursor: pointer !important; box-shadow: none !important; display: flex !important; align-items: center !important; justify-content: center !important; }' +
        '.cc-eqn-split-fold:hover { color: var(--cc-accent, #003794) !important; border-color: var(--cc-accent, #003794) !important; }' +
        // contain: size - the list's length is no reason for the dialog to grow; the panel takes the
        // editing area's height (stretched, as a flex item) and scrolls within it. layout, as the API
        // has it, keeps its search box anchored to the panel.
        '.cc-eqn-predictor { flex: 0 0 auto !important; min-width: 0 !important; min-height: 0 !important; overflow: auto !important; box-sizing: border-box !important; contain: size layout !important; }' +
        '.cc-eqn-dragging, .cc-eqn-dragging * { cursor: col-resize !important; user-select: none !important; }' +
        // Below the editing area (cc-eqn-stacked): the same parts turned through a right angle.
        '.cc-eqn-stacked { flex-direction: column !important; }' +
        '.cc-eqn-stacked .cc-eqn-split { width: auto !important; height: 9px !important; margin: 2px 0 !important; cursor: row-resize !important; }' +
        '.cc-eqn-stacked .cc-eqn-split::before { top: 4px !important; bottom: auto !important; left: 0 !important; right: 0 !important; width: auto !important; height: 1px !important; }' +
        '.cc-eqn-stacked .cc-eqn-split:hover::before, .cc-eqn-stacked .cc-eqn-split:focus-visible::before, .cc-eqn-stacked.cc-eqn-dragging .cc-eqn-split::before { top: 3px !important; left: 0 !important; width: auto !important; height: 3px !important; }' +
        '.cc-eqn-stacked .cc-eqn-split-fold { width: 34px !important; height: 16px !important; }' +
        '.cc-eqn-stacked .cc-eqn-predictor { width: auto !important; }' +
        '.cc-eqn-stacked.cc-eqn-dragging, .cc-eqn-stacked.cc-eqn-dragging * { cursor: row-resize !important; }' +
        // The suggestions' maths set as the maths view's is: a host's reset (TinyMCE's .tox
        // :not(svg) { font-family: inherit; font-style: inherit }) outranks the API's .fxtex rules,
        // which left it in the dialog's sans-serif with its letters upright (the browser italicises
        // them through text-transform, which the reset takes too). Reverted to the browser's own
        // maths styling, as the maths view is, then the API's .fxtex rules re-asserted for the panel.
        '.cc-eqn-predictor math, .cc-eqn-predictor math * { font: revert-layer !important; text-transform: revert-layer !important; ' +
            'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; margin: revert-layer !important; ' +
            'text-align: revert-layer !important; box-sizing: revert-layer !important; white-space: revert-layer !important; }';
    for ( var i = 0; i < document.styleSheets.length; i++ ) {
        var rules;
        try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
        for ( var j = 0; j < rules.length; j++ ) {
            var r = rules[ j ], decls = '';
            var sel = r.selectorText && r.selectorText.replace( /:where\(\.fxEditor\)\s*/g, '' ).trim();
            if ( !sel || !/^\.fxtex\b/.test( sel ) || sel.indexOf( ',' ) > -1 ) continue;
            for ( var k = 0; k < r.style.length; k++ ) {
                decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
            }
            if ( decls ) style.textContent += '.cc-eqn-predictor ' + sel + '{' + decls + '}';
        }
    }
    document.head.appendChild( style );
}

function apiMathRules() {
    let out = '';
    for ( const sheet of document.styleSheets ) {
        let rules;
        try { rules = sheet.cssRules; } catch ( e ) { continue; }
        for ( const r of rules ) {
            if ( !r.selectorText || !/(^|,)\s*(:where\(\.fxEditor\)\s*)?\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
            let decls = '';
            for ( const p of r.style ) {
                decls += `${ p }:${ r.style.getPropertyValue( p ) } !important;`;
            }
            if ( decls ) out += r.selectorText.replace( /:where\(\.fxEditor\)\s*/g, '' ).split( ',' ).map( s => ( /^\.CCMathView\b/.test( s.trim() ) ? s.trim() : `.CCMathView ${ s.trim() }` ) ).join( ',' ) + `{${ decls }}`;
        }
    }
    return out;
}

/* -------------------------------------------------------------------------------------------
 * Unique element ids
 * ----------------------------------------------------------------------------------------
 * The Equation Editor API addresses its parts by element id, and every previous version of
 * this plugin hard-coded 'toolbar', 'latexInput', 'output' and 'history'. Those are ordinary
 * words: a host page very often owns an element called #toolbar or #output already, and two
 * CKEditor instances on one page always collided with each other. Each plugin instance now
 * gets its own suffix, and the styling comes from classes (see fxeditor.css) rather than
 * from the ids, so nothing depends on the names any more.
 */
let instanceCount = 0;

/* ===========================================================================================
 * The plugin
 * ======================================================================================== */

class DoubleClickObserver extends DomEventObserver {
    constructor( view ) {
        super( view );
        this.domEventType = 'dblclick';
    }

    onDomEvent( domEvent ) {
        this.fire( domEvent.type, domEvent );
    }
}

class Eqneditor5 extends Plugin {
    static get pluginName() {
        return 'Equation Editor 5';
    }

    static get requires() {
        return [ ContextualBalloon ];
    }

    init() {
        const editor = this.editor;
        const config = editor.config.get( 'eqnEditor' ) || {};

        // `server` is the documented spelling. `Server` was what the website's examples showed
        // against v2.0.x while the code only ever read `server`, so both are accepted rather
        // than silently ignoring a configuration someone copied from the documentation.
        const host = config.server || config.Server || DEFAULT_EDITOR_HOST;
        // A bare host means https; a full origin (e.g. http://localhost:8010 for local development) is used as it is.
        const origin = /^https?:\/\//.test( host ) ? host.replace( /\/+$/, '' ) : `https://${ host }`;

        this._renderUrl = config.renderUrl || DEFAULT_RENDER_URL;
        this._licence = config.licence || '';
        this._design = config.design || {};
        this._ids = makeIds( ++instanceCount );

        const scriptUrl = config.scriptUrl || `${ origin }/fxeditor.api.min.js`;
        const cssUrl = config.cssUrl || `${ origin }/fxeditor.css`;
        this._cssUrl = cssUrl;
        // The MathML the editor produces needs a handful of rules browsers' own MathML does
        // not provide - see fxtex.css's own header. Loaded unconditionally, since the "Insert
        // as" choice lives in the panel now rather than being fixed at configuration time.
        this._mathmlCssUrl = config.mathmlCssUrl || `${ origin }/fxtex.css`;

        loadCssOnce( cssUrl );
        loadCssOnce( this._mathmlCssUrl );
        this._apiReady = loadScriptOnce( scriptUrl );

        this._defineMathMLSchema();
        this._defineImageReferrerSchema();

        this._balloon = editor.plugins.get( ContextualBalloon );
        this.eqnView = this._createEqnEditorView();
        this.editorReady = false;

        editor.ui.componentFactory.add( 'EqnEditor5', locale => {
            const button = new ButtonView( locale );

            button.set( {
                label: editor.t( 'Equation Editor 5' ),
                icon: fxIcon,
                tooltip: true
            } );

            button.on( 'execute', () => this._initEqnEditor( locale ) );

            return button;
        } );

        // Double-clicking an equation reopens it for editing.
        const view = editor.editing.view;

        view.addObserver( DoubleClickObserver );
        editor.listenTo( view.document, 'dblclick', ( e, dat ) => {
            const found = this._equationAt( dat.domTarget );
            if ( !found ) return;

            // The browser's own double-click would select a word (or the image widget's label)
            // as the editor opens.
            dat.preventDefault();

            // Remembered, so that OK replaces this equation rather than inserting another beside it
            // (see the 'submit' listener). Meanwhile the cursor goes just after it: the double-
            // click's first click has selected an image equation, and a selected image brings up
            // CKEditor's own image toolbar, which takes the balloon from the equation editor.
            this._editing = found.element;
            editor.model.change( writer => writer.setSelection( found.element, 'after' ) );
            this._initEqnEditor( null, found.latex, found.mode );
        } );
    }

    /**
     * The equation a double-click landed in, as { element: its model element, latex, mode: 'mathml' or 'svg' }, or null.
     * Found from its wrapper rather than the exact element clicked: the click can land anywhere
     * in the equation's box - on the wrapper's own edges as much as on the <math> or <img>.
     */
    _equationAt( target ) {
        if ( !target || !target.closest ) return null;

        let dom = null, latex = '', mode = '';

        // A MathML equation. The model keeps the LaTeX (see _insertMathML), and the wrapper
        // carries it as data-cc-latex; the <math> element's own title holds it too.
        const wrapper = target.closest( '.cc-equation' );
        if ( wrapper ) {
            const math = wrapper.querySelector( 'math[title]' );
            dom = wrapper;
            mode = 'mathml';
            latex = wrapper.getAttribute( 'data-cc-latex' ) || ( math && math.getAttribute( 'title' ) ) || '';
        } else {
            // An image equation: the LaTeX is recovered from the rendering request that produced it.
            const widget = target.closest( '.image-inline' );
            const img = target.nodeName.toLowerCase() === 'img' ? target : widget && widget.querySelector( 'img' );
            const match = img && img.src.match( /(gif|svg|png)\.image\?(.*)/ );
            if ( match ) {
                dom = widget || img;
                mode = 'svg';
                latex = decodeEquation( match[ 2 ] );
            }
        }

        latex = latex.trim();
        if ( !dom || !latex ) return null;

        const viewElement = this.editor.editing.view.domConverter.mapDomToView( dom );
        const element = viewElement && this.editor.editing.mapper.toModelElement( viewElement );
        return element ? { element, latex, mode } : null;
    }

    /* --- opening ------------------------------------------------------------------------ */

    // `mode`, for an equation reopened from the document: what it was ('mathml' or 'svg'), so that
    // it stays that - an image equation edited is still an image.
    _initEqnEditor( locale, inp = '', mode = '' ) {
        this._showUI( locale );

        this._apiReady.then( () => ensureInit( this._licence ) ).then( () => {
            injectStyleOverridesOnce( this._cssUrl.slice( 0, this._cssUrl.lastIndexOf( '/' ) + 1 ) + 'prototypes/latinmodern-math.otf' );

            if ( !this.editorReady ) {
                this._mount();
                this.editorReady = true;
            }

            this.textarea.clear();
            if ( inp ) {
                this.textarea.insert( inp, inp.length );
            }
            if ( mode && this.eqnView.insertModeSelect ) {
                this.eqnView.insertModeSelect.value = mode;
            }
            this.textarea.notifyOutputs();

            // Ready to type into, with its cursor showing - focus otherwise stays on the button
            // that opened the editor (or in the document, after a double-click).
            const root = document.getElementById( this._ids.root );
            const pane = root && root.querySelector( root.getAttribute( 'data-latex' ) === 'on' ? '.CCLatexInput' : '.CCMathView' );
            if ( pane ) pane.focus( { preventScroll: true } );
        } ).catch( err => {
            console.error( err );
        } );
    }

    /**
     * Builds the Equation Editor inside the balloon: a toolbar and a WYSIWYG MathML view, plus
     * a LaTeX markup pane hidden until asked for. Built once per balloon instance and reused
     * on every open - EqEditor.TextArea.link()/MathView.link() bind to specific DOM elements,
     * and this balloon's content (unlike a dialog's) is not rebuilt between opens.
     */
    _mount() {
        const ids = this._ids;

        this.output = new EqEditor.Output( ids.output );
        this.output.setRenderURL( this._renderUrl );

        this.textarea = EqEditor.TextArea.link( ids.latexInput )
            .addOutput( this.output )
            .addHistoryMenu( new EqEditor.History( ids.history ) );

        this.toolbar = EqEditor.Toolbar.link( ids.toolbar, this._design.toolbar || 'default', this._design.toolbarScale || 1 ).addTextArea( this.textarea );

        // MathView arrived in the 5.x API. Guard rather than require it, so a site pinned to
        // an older bundle still gets the markup editor instead of a broken panel.
        if ( typeof EqEditor.MathView !== 'undefined' ) {
            this.mathview = EqEditor.MathView.link( ids.mathview ).addTextArea( this.textarea );
            this.toolbar.addMathView( this.mathview );
        } else {
            // Without a maths view the markup is the only thing to edit in - force it visible
            // and lock the toggle so it cannot be switched to an empty pane.
            const root = document.getElementById( ids.root );
            root.setAttribute( 'data-latex', 'on' );
            this.eqnView.latexCheckbox.checked = true;
            this.eqnView.latexCheckbox.disabled = true;
        }

        // The history menu's buttons pick up the host page's own button padding otherwise.
        const nodes = document.getElementById( ids.history ).childNodes;
        for ( let i = 0; i < nodes.length; i++ ) {
            if ( nodes[ i ].style ) {
                nodes[ i ].style.padding = 'revert';
            }
        }

        addEditorControls( document.getElementById( ids.root ), this._design, { textArea: this.textarea, mathView: this.mathview, output: this.output,
            latexToggle: this.eqnView.latexCheckbox, inlineToggle: this.eqnView.inlineCheckbox } );
        applyDesign( document.getElementById( ids.root ), this._design,
            this.eqnView.latexCheckbox, this.eqnView.insertModeSelect );

        // The API draws the MathView's caret where the cursor is at that moment, and only redraws
        // it on an edit or on focus - but the balloon goes on settling after it first opens (its
        // fonts arrive, the toolbar fits itself to its row) and the equation, centred in its
        // area, moves out from under the caret. Its focus handler only redraws (it leaves the
        // cursor where it is), so it is fired again whenever the area changes size while focused.
        const host = document.getElementById( ids.mathview );
        const pane = host && host.querySelector( '.CCMathView' );
        if ( pane && typeof ResizeObserver !== 'undefined' ) {
            new ResizeObserver( () => {
                if ( document.activeElement === pane ) pane.dispatchEvent( new FocusEvent( 'focus' ) );
            } ).observe( host );
        }
    }

    /* --- writing the equation into the document ------------------------------------------ */

    /** MathML by default; an <img> against the SVG rendering service if "Insert as" says so. */
    _insertEquation( latex ) {
        if ( this.eqnView.insertModeSelect && this.eqnView.insertModeSelect.value === 'svg' ) {
            return this._insertImage( latex );
        }
        return this._insertMathML( latex );
    }

    /** An <img> at the rendering service. referrerPolicy is set explicitly (see
     * _defineImageReferrerSchema()) rather than left to the page's own Referrer-Policy:
     * latex.codecogs.com identifies the calling site by referer, and a page with a stricter
     * policy (or none at all, on some browsers' defaults) would otherwise send none at all. */
    _insertImage( latex ) {
        const editor = this.editor;
        const src = outputCode( this.output, 'url' );

        editor.model.change( writer => {
            const image = writer.createElement( 'imageInline', {
                src,
                // The LaTeX, not a placeholder. This is what a screen reader reads out, what
                // shows if the rendering service is unreachable, and what a search index sees -
                // a generic string here made every equation on a page indistinguishable from
                // every other one.
                alt: latex,
                referrerPolicy: 'origin'
            } );

            editor.model.insertContent( image, editor.model.document.selection );
        } );
    }

    /**
     * The MathML itself, as an inline object this plugin defines.
     *
     * CKEditor drops elements its schema does not know, and <math> is in none of the stock
     * schemas. General HTML Support does not rescue it either: GHS only handles elements
     * present in CKEditor's own DataSchema, and MathML is not - so an `allow` rule naming
     * <math> matches nothing and the equation vanishes on insert. Rather than hand that
     * problem to every integrator, the plugin registers its own element for it (see
     * _defineMathMLSchema), which needs no configuration at all.
     *
     * What is stored in the model is the LaTeX, not the markup. The MathML is regenerated from
     * it on the way out, which keeps one source of truth, means an equation can still be
     * reopened and edited after a save-and-reload, and means a converter improvement reaches
     * existing documents rather than only new ones.
     */
    _insertMathML( latex ) {
        const editor = this.editor;

        editor.model.change( writer => {
            const element = writer.createElement( 'ccMathML', { latex } );
            editor.model.insertContent( element, editor.model.document.selection );
        } );
    }

    /**
     * Registers the inline element the MathML mode writes, and the two directions it converts
     * in. Registered unconditionally at init now, since which insert mode is used is a choice
     * made in the panel each time rather than a fixed configuration value.
     */
    _defineMathMLSchema() {
        const editor = this.editor;

        editor.model.schema.register( 'ccMathML', {
            inheritAllFrom: '$inlineObject',
            allowAttributes: [ 'latex' ]
        } );

        // The published markup: real MathML, wrapped in a span that carries the source LaTeX so
        // the equation stays editable. A raw element because its contents are markup this
        // plugin produced, not a structure CKEditor needs to understand.
        const toView = ( modelElement, { writer } ) => {
            const latex = modelElement.getAttribute( 'latex' ) || '';

            return writer.createRawElement(
                'span',
                { class: 'cc-equation', 'data-cc-latex': latex },
                domElement => {
                    domElement.innerHTML = this._renderMathML( latex );
                }
            );
        };

        editor.conversion.for( 'editingDowncast' ).elementToElement( { model: 'ccMathML', view: toView } );
        editor.conversion.for( 'dataDowncast' ).elementToElement( { model: 'ccMathML', view: toView } );

        // Reading a saved document back: the LaTeX comes off the wrapper, and the MathML inside
        // it is discarded and regenerated rather than parsed.
        editor.conversion.for( 'upcast' ).elementToElement( {
            view: { name: 'span', attributes: { 'data-cc-latex': true } },
            model: ( viewElement, { writer } ) =>
                writer.createElement( 'ccMathML', { latex: viewElement.getAttribute( 'data-cc-latex' ) || '' } )
        } );
    }

    /**
     * imageInline's stock schema has no opinion on referrerPolicy - without registering it,
     * the model attribute set in _insertImage() above is silently dropped rather than reaching
     * the published <img> at all (found by inspecting the downcast output after the first
     * attempt: no referrerpolicy attribute on the element, model or view). Needs the Image
     * plugin; guarded so a host without it (an install using only the MathML insert mode)
     * doesn't error registering an attribute on a schema item that doesn't exist.
     */
    _defineImageReferrerSchema() {
        const editor = this.editor;
        if ( !editor.model.schema.isRegistered( 'imageInline' ) ) return;

        editor.model.schema.extend( 'imageInline', { allowAttributes: [ 'referrerPolicy' ] } );
        editor.conversion.attributeToAttribute( {
            model: 'referrerPolicy',
            view: 'referrerpolicy'
        } );
    }

    /** LaTeX to MathML, through the API's own converter so the plugin and the editor cannot
     * disagree about what the markup should be. */
    _renderMathML( latex ) {
        if ( !latex || typeof EqEditor === 'undefined' ||
             typeof EqEditor.Output.latexToMathML !== 'function' ) return '';

        return EqEditor.Output.latexToMathML( latex, true );
    }


    /* --- the balloon view --------------------------------------------------------------- */

    _createEqnEditorView() {
        const editor = this.editor;
        const view = new EqnEditorView( editor.locale, this._ids );

        // The controls only exist once the view has rendered, which the balloon does when it
        // is first shown - hence binding on the element rather than holding it from here.
        this.listenTo( view, 'render', () => {
            view.latexCheckbox.addEventListener( 'change', () => {
                const visible = view.latexCheckbox.checked;
                document.getElementById( this._ids.root ).setAttribute( 'data-latex', visible ? 'on' : 'off' );
                // Hiding the markup has to move the toolbar's target back to the maths view,
                // and vice versa, otherwise a button pressed straight afterwards inserts into
                // a pane nobody can see.
                if ( this.toolbar ) {
                    this.toolbar.setActiveTextArea( visible ? this.textarea : ( this.mathview || this.textarea ) );
                }
            } );

            view.inlineCheckbox.addEventListener( 'change', () => {
                const inline = view.inlineCheckbox.checked;
                document.getElementById( this._ids.root ).setAttribute( 'data-inline', inline ? 'on' : 'off' );
                if ( this.mathview ) this.mathview.setInline( inline );
                if ( this.output ) this.output.setInline( inline );
            } );
        }, { priority: 'low' } );

        this.listenTo( view, 'submit', () => {
            const latex = this.textarea.getTextArea().textContent.trim();

            if ( latex ) {
                // Reopened from the document: selected, the equation is replaced by the edit.
                const editing = this._editing;
                if ( editing && editing.root && editing.root.rootName !== '$graveyard' ) {
                    this.editor.model.change( writer => writer.setSelection( editing, 'on' ) );
                }
                this._insertEquation( latex );
                this.textarea.pushToHistory();
            }

            // v2.0.x dropped this, leaving the balloon open after Save with the previous
            // equation still in it.
            this._hideUI();
        } );

        this.listenTo( view, 'cancel', () => this._hideUI() );

        clickOutsideHandler( {
            emitter: view,
            activator: () => this._balloon.visibleView === view,
            contextElements: [ this._balloon.view.element ],
            callback: () => this._hideUI()
        } );

        return view;
    }

    _hideUI() {
        if ( this.editorReady ) {
            const out = document.getElementById( this._ids.output );
            if ( out ) {
                out.removeAttribute( 'src' );
            }
            this.textarea.clear();
        }

        this._editing = null;

        if ( this._balloon.hasView( this.eqnView ) ) {
            this._balloon.remove( this.eqnView );
        }

        this.editor.editing.view.focus();
    }

    _showUI() {
        if ( this._balloon.visibleView === this.eqnView ) {
            return;
        }

        // v2.0.x read a bare `balloon` here, which is not defined anywhere in the module - so
        // opening the equation editor while any other balloon (a link form, an image toolbar)
        // was showing threw a ReferenceError and nothing appeared.
        if ( this._balloon.visibleView ) {
            this._balloon.remove( this._balloon.visibleView );
        }

        this._balloon.add( {
            view: this.eqnView,
            singleViewMode: true,
            position: this._getBalloonPositionData()
        } );

        this._balloon.showStack( 'main' );
        this._balloon.updatePosition( this._getBalloonPositionData() );

        // Lets the balloon measure itself once its contents have been laid out.
        setTimeout( () => window.dispatchEvent( new Event( 'resize' ) ), 0 );
    }

    /* --- positioning -------------------------------------------------------------------- */

    _isElementEditable( element ) {
        if ( !( element instanceof HTMLElement ) ) {
            return false;
        }
        return element.closest( '.ck-editor__editable' ) !== null;
    }

    _findClosestEditableParent( element ) {
        while ( element && !this._isElementEditable( element ) ) {
            element = element.parentElement;
        }
        return element;
    }

    _getBalloonPositionData() {
        const view = this.editor.editing.view;
        const firstRange = view.document.selection.getFirstRange();

        if ( !firstRange ) {
            return { target: () => document.querySelector( '.ck-content' ) };
        }

        let domTarget = view.domConverter.viewRangeToDom( firstRange );

        if ( !domTarget || !domTarget.getBoundingClientRect ||
             !this._isElementEditable( domTarget ) ) {
            domTarget = this._findClosestEditableParent( domTarget ) ||
                document.querySelector( '.ck-content' );
        }

        return { target: () => domTarget };
    }
}

/* ===========================================================================================
 * The balloon's contents
 * ======================================================================================== */

class EqnEditorView extends View {
    constructor( locale, ids ) {
        super( locale );

        this.saveButtonView = this._createButton( 'OK', 'ck-button-save cc-eqn-btn cc-eqn-primary' );
        this.saveButtonView.type = 'submit';

        this.cancelButtonView = this._createButton( 'Cancel', 'ck-button-cancel cc-eqn-btn' );
        this.cancelButtonView.delegate( 'execute' ).to( this, 'cancel' );

        // Checkboxes styled as switches, matching the auto-brackets switch the History menu
        // draws. Deliberately not CKEditor ButtonViews: those arrive carrying .ck-button,
        // which had to be fought with overrides, and a two-state control is a checkbox rather
        // than a button anyway. Held once rendered - see render() below.
        this.inlineCheckbox = null;
        this.latexCheckbox = null;
        this.insertModeSelect = null;

        this.setTemplate( {
            tag: 'form',
            attributes: {
                class: [ 'ck', 'ck-eqneditor-form' ],
                tabindex: '-1'
            },
            children: [
                {
                    tag: 'div',
                    attributes: {
                        id: ids.root,
                        // Out of CKEditor's own reset (.ck-reset_all, which the balloon carries): its
                        // `position: static; width: auto; background: none` outranks the API's rules -
                        // left in, the MathView's drawn caret had no size, colour or place, and there
                        // was no cursor at all.
                        class: [ 'CCEqnEditor', 'ck-reset_all-excluded' ],
                        'data-latex': 'off',
                        'data-inline': 'off'
                    },
                    children: [
                        {
                            tag: 'div',
                            attributes: { class: 'CCEditorBar' },
                            children: [
                                { tag: 'div', attributes: { id: ids.history, class: 'CCHistory' } }
                            ]
                        },
                        { tag: 'div', attributes: { id: ids.toolbar } },
                        { tag: 'div', attributes: { id: ids.mathview, class: 'CCMathViewHost' } },
                        // Hidden until the LaTeX toggle is on - see injectStyleOverridesOnce().
                        {
                            tag: 'div',
                            attributes: {
                                id: ids.latexInput,
                                class: 'CCLatexInput',
                                autocorrect: 'off',
                                placeholder: 'Write LaTeX here...'
                            }
                        },
                        // No rendered-equation preview in the panel any more - MathView is the
                        // whole editing surface. this.output still needs a DOM element to bind
                        // to (it is what builds the SVG URL for the "Image (SVG)" insert mode),
                        // so the element stays, just not visible.
                        { tag: 'img', attributes: { id: ids.output, class: 'CCEqnOutput-hidden', alt: '' } },
                        {
                            tag: 'div',
                            attributes: { class: 'CCBottomBar cc-eqn-bar' },
                            children: [
                                {
                                    tag: 'label',
                                    attributes: {
                                        class: 'cc-switch',
                                        title: 'Left-align the equation instead of centring it'
                                    },
                                    children: [
                                        { tag: 'input', attributes: { type: 'checkbox', class: 'cc-inline-toggle' } },
                                        {
                                            tag: 'span', attributes: { class: 'cc-switch-track' },
                                            children: [ { tag: 'span', attributes: { class: 'cc-switch-knob' } } ]
                                        },
                                        { tag: 'span', attributes: { class: 'cc-switch-label' }, children: [ 'Inline' ] }
                                    ]
                                },
                                {
                                    tag: 'label',
                                    attributes: {
                                        class: 'cc-switch',
                                        title: 'Show or hide the LaTeX markup'
                                    },
                                    children: [
                                        { tag: 'input', attributes: { type: 'checkbox', class: 'cc-latex-toggle' } },
                                        {
                                            tag: 'span', attributes: { class: 'cc-switch-track' },
                                            children: [ { tag: 'span', attributes: { class: 'cc-switch-knob' } } ]
                                        },
                                        { tag: 'span', attributes: { class: 'cc-switch-label' }, children: [ 'LaTeX' ] }
                                    ]
                                },
                                {
                                    tag: 'div',
                                    attributes: { class: 'cc-eqn-bar-right' },
                                    children: [
                                        {
                                            tag: 'select',
                                            attributes: { class: 'cc-insert-mode cc-eqn-select', title: 'How to insert the equation' },
                                            children: [
                                                { tag: 'option', attributes: { value: 'mathml', selected: 'selected' }, children: [ 'Insert MathML' ] },
                                                { tag: 'option', attributes: { value: 'svg' }, children: [ 'Insert SVG' ] }
                                            ]
                                        },
                                        this.cancelButtonView,
                                        this.saveButtonView
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        } );
    }

    _createButton( label, className ) {
        const button = new ButtonView();
        button.set( { label, withText: true, class: className } );
        return button;
    }

    render() {
        super.render();
        submitHandler( { view: this } );

        this.latexCheckbox = this.element.querySelector( '.cc-latex-toggle' );
        this.inlineCheckbox = this.element.querySelector( '.cc-inline-toggle' );
        this.insertModeSelect = this.element.querySelector( '.cc-insert-mode' );
    }

    focus() {
        this.element.querySelector( '.CCLatexInput, .CCMathViewHost' )?.focus();
    }
}

/* ===========================================================================================
 * Helpers
 * ======================================================================================== */

function makeIds( n ) {
    return {
        root: `cc-eqn-${ n }`,
        history: `cc-eqn-history-${ n }`,
        toolbar: `cc-eqn-toolbar-${ n }`,
        mathview: `cc-eqn-mathview-${ n }`,
        latexInput: `cc-eqn-latex-${ n }`,
        output: `cc-eqn-output-${ n }`
    };
}

/**
 * Turns the equation back out of a rendering URL. The renderer's own escaping replaces the
 * characters that would otherwise end the query string or be eaten by it, so they have to come
 * back out in the same form - "&plus;" in particular, which used to be left in place and
 * reopened "a+b" as the literal text "a&plus;b".
 */
function decodeEquation( encoded ) {
    let latex = encoded;

    try {
        latex = decodeURIComponent( encoded );
    } catch ( e ) {
        // A URL that is not valid percent-encoding is still worth showing as-is.
    }

    return latex
        .replace( /&space;/g, ' ' )
        .replace( /&plus;/g, '+' )
        .replace( /&hash;/g, '#' );
}

export { Eqneditor5 as eqnEditor5 };
export default Eqneditor5;
