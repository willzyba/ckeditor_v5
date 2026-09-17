import { Eqneditor5 as Eqneditor5Dll, icons } from '../src';
import Eqneditor5 from '../src/eqneditor5';

import ckeditor from './../theme/icons/ckeditor.svg';

describe( 'CKEditor5 Eqneditor5 DLL', () => {
	it( 'exports Eqneditor5', () => {
		expect( Eqneditor5Dll ).to.equal( Eqneditor5 );
	} );

	describe( 'icons', () => {
		it( 'exports the "ckeditor" icon', () => {
			expect( icons.ckeditor ).to.equal( ckeditor );
		} );
	} );
} );
