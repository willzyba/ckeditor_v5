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
 *       eqnEditor: { server: 'fxeditor.codecogs.com' }
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

// Where the editor's own code is served from. fxeditor.codecogs.com serves the current API bundle
// (fxTeX Pro, the MathML view); editor.codecogs.com and latex.codecogs.com still answer but
// serve older builds, so neither is the default any more.
const DEFAULT_EDITOR_HOST = 'fxeditor.codecogs.com';

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
// once eqneditor.api.min.js itself has loaded. Called once per page; an empty licence is the
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

// Gaps in the shared eqneditor.css (loaded separately, asynchronously, from the configured
// host) this panel needs but can't assume it will get:
//  - editor.codecogs.com, the old default host and still configurable, serves an older stylesheet that predates
//    the CCEqnEditor/CCMathViewHost/CCLatexInput class names entirely (only a local dev mirror
//    does not have this gap), so the LaTeX/maths mutual-exclusion below is written defensively
//    rather than left to eqneditor.css;
//  - this is a balloon, not a dialog, so by default it sizes to fit its content - CKEditor's
//    own .ck-balloon-panel has no opinion on how big an 850px-wide, mostly-empty maths view
//    should be, so this gives it one;
//  - there is no rendered-equation preview and no LaTeX box visible by default (see
//    EqnEditorView's template), so the maths view needs to fill the space between the toolbar
//    and the bottom bar itself.
// Injected once, since it would otherwise race eqneditor.css over which rule wins.
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
            `src: local("Latin Modern Math"), url("${ fontUrl }") format("opentype"); }` +
        // Undo host resets (e.g. .cke_reset_all *) inside the toolbar icons and the maths view's MathML.
        '.CCToolbar svg:has(g[font-family]), .CCToolbar svg:has(g[font-family]) * { font: revert-layer !important; }' +
        // Older API builds draw the icons as plain <text>, fonted by the API's own .cc_panel rule instead.
        '.CCToolbar svg:not(:has(g[font-family])) { font: normal normal 16px "fxTeX Toolbar" !important; }' +
        '.CCToolbar svg:not(:has(g[font-family])) * { font: inherit !important; }' +
        '.CCToolbar svg, .CCToolbar svg * { width: revert-layer !important; height: revert-layer !important; max-width: revert-layer !important; }' +
        '.CCToolbar svg g[font-family="fxTeX Toolbar"] { color: #000 !important; }' +
        '.CCMathView math, .CCMathView math * { font: revert-layer !important; ' +
            'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; ' +
            'margin: revert-layer !important; text-transform: revert-layer !important; text-align: revert-layer !important; ' +
            'box-sizing: revert-layer !important; white-space: revert-layer !important; }' +
        apiMathRules() +
        '.ck-balloon-panel:has(.CCEqnEditor) { width: 850px !important; max-width: 96vw !important; }' +
        '.ck-eqneditor-form { display: flex !important; flex-direction: column !important; padding: 12px 14px !important; }' +
        '.CCEqnEditor { display: flex !important; flex-direction: column !important; ' +
            'height: 480px !important; flex: 1 1 auto !important; }' +
        '.CCEqnEditor .CCEditorBar { flex: 0 0 auto; }' +
        // A flex column's children stretch to the container's full width by default - the
        // toolbar's own "fit" pass (EqEditor's Toolbar.link, run once at construction) measures
        // whatever width it is given and unwraps each button group into as many columns as
        // that width allows. Left stretched to the balloon's 850px, that is well past the
        // toolbar's natural width (~780px on the reference page, which is never stretched) -
        // so every group unwraps wider and flatter than it was designed to, reading as sparse,
        // undersized icons in a mostly empty row instead of the tighter reference layout.
        // flex-start plus width:auto (both needed - a flex-start item with no width of its own
        // still stretches otherwise) leaves it free to size to its own fitted content instead.
        '.CCEqnEditor [id^="cc-eqn-toolbar-"] { align-self: flex-start; width: auto; }' +
        '.CCEqnEditor .CCMathViewHost { ' +
            'flex: 1 1 auto; min-height: 0; display: flex; align-items: center; ' +
            'justify-content: center; overflow: auto; }' +
        '.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start; }' +
        '.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
        '.CCEqnEditor .CCLatexInput { flex: 1 1 auto; min-height: 0; overflow: auto; }' +
        '.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
        '.CCEqnEditor .CCEqnOutput-hidden { display: none !important; }' +
        // The bottom bar: toggles left, Insert-as and the dialog's buttons right, one type size. All !important - host dialog resets otherwise restyle it.
        '.cc-eqn-bar { display: flex !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
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
        // eqneditor.css caps this at min(760px, 92vw), which left it hard against the left of the 850px balloon.
        '.ck-eqneditor-form .CCEqnEditor { width: auto !important; align-self: stretch !important; }';
    document.head.appendChild( style );
}

// Re-asserts the API's own .CCMathView/.fxtex rules, which host resets and revert-layer override.
// The `design` option (see the README): how the editor looks, set by the site rather than the
// author. The toolbar's rows and scale go to Toolbar.link() itself; everything else is applied
// here, once the editor is mounted - CSS scoped to this editor's root, then the starting state of
// the LaTeX toggle and the "Insert as" menu.
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
    if ( insertSelect && design.insertAs && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
        insertSelect.value = design.insertAs;
    }
    if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
        latexToggle.checked = true;
        latexToggle.dispatchEvent( new Event( 'change', { bubbles: true } ) );
    }
}

function apiMathRules() {
    let out = '';
    for ( const sheet of document.styleSheets ) {
        let rules;
        try { rules = sheet.cssRules; } catch ( e ) { continue; }
        for ( const r of rules ) {
            if ( !r.selectorText || !/(^|,)\s*\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
            let decls = '';
            for ( const p of r.style ) {
                decls += `${ p }:${ r.style.getPropertyValue( p ) } !important;`;
            }
            if ( decls ) out += r.selectorText.split( ',' ).map( s => ( /^\.CCMathView\b/.test( s.trim() ) ? s.trim() : `.CCMathView ${ s.trim() }` ) ).join( ',' ) + `{${ decls }}`;
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
 * gets its own suffix, and the styling comes from classes (see eqneditor.css) rather than
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

        const scriptUrl = config.scriptUrl || `${ origin }/eqneditor.api.min.js`;
        const cssUrl = config.cssUrl || `${ origin }/eqneditor.css`;
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
            const target = dat.domTarget;
            if ( !target ) return;

            // An image equation: the LaTeX is recovered from the rendering request that
            // produced it.
            if ( target.nodeName.toLowerCase() === 'img' ) {
                const match = target.src.match( /(gif|svg|png)\.image\?(.*)/ );
                if ( match ) {
                    this._editing = target;
                    this._initEqnEditor( null, decodeEquation( match[ 2 ] ) );
                }
                return;
            }

            // A MathML equation. The converter writes the source LaTeX into the <math> element's
            // own title attribute, so the equation carries what it was written from and can be
            // reopened without anyone having to parse MathML back into LaTeX.
            const math = target.closest && target.closest( 'math[title]' );
            if ( math ) {
                const latex = math.getAttribute( 'title' ).trim();
                if ( latex ) {
                    this._editing = math;
                    this._initEqnEditor( null, latex );
                }
            }
        } );
    }

    /* --- opening ------------------------------------------------------------------------ */

    _initEqnEditor( locale, inp = '' ) {
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
            this.textarea.notifyOutputs();
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

        applyDesign( document.getElementById( ids.root ), this._design,
            this.eqnView.latexCheckbox, this.eqnView.insertModeSelect );
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
        const src = this.output.exportAs( 'url' );

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
                        class: 'CCEqnEditor',
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
                                        { tag: 'span', attributes: { class: 'cc-switch-label' }, children: [ 'LaTeX markup' ] }
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
                                                { tag: 'option', attributes: { value: 'mathml', selected: 'selected' }, children: [ 'Insert as MathML' ] },
                                                { tag: 'option', attributes: { value: 'svg' }, children: [ 'Insert as image (SVG)' ] }
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
