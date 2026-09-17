import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import Heading from '@ckeditor/ckeditor5-heading/src/heading';
import ClassicEditor from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';
import Eqneditor5 from '../src/eqneditor5';

/* global document */

describe( 'Eqneditor5', () => {
	it( 'should be named', () => {
		expect( Eqneditor5.pluginName ).to.equal( 'Eqneditor5' );
	} );

	describe( 'init()', () => {
		let domElement, editor;

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				plugins: [
					Paragraph,
					Heading,
					Essentials,
					Eqneditor5
				],
				toolbar: [
					'eqneditor5Button'
				]
			} );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'should load Eqneditor5', () => {
			const myPlugin = editor.plugins.get( 'Eqneditor5' );

			expect( myPlugin ).to.be.an.instanceof( Eqneditor5 );
		} );

		it( 'should add an icon to the toolbar', () => {
			expect( editor.ui.componentFactory.has( 'eqneditor5Button' ) ).to.equal( true );
		} );

		it( 'should add a text into the editor after clicking the icon', () => {
			const icon = editor.ui.componentFactory.create( 'eqneditor5Button' );

			expect( editor.getData() ).to.equal( '' );

			icon.fire( 'execute' );

			expect( editor.getData() ).to.equal( '<p>Hello CKEditor 5!</p>' );
		} );
	} );
} );
