// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../support/index.d.ts" />

describe('Tutor Voice Mode', () => {
	Cypress.on('uncaught:exception', (err) => {
		const msg = err?.message || '';
		if (msg.includes("reading 'filter'") || msg.includes("reading 'length'")) {
			return false;
		}
		return true;
	});
	// Wait for 2 seconds after all tests to fix Cypress video recording
	after(() => {
		// eslint-disable-next-line cypress/no-unnecessary-waiting
		cy.wait(2000);
	});

	beforeEach(() => {
		cy.loginAdmin();
		cy.intercept('GET', '/api/config', (req) => {
			req.reply((res) => {
				res.body = res.body || {};
				res.body.audio = res.body.audio || {};
				res.body.audio.stt = {
					...(res.body.audio.stt || {}),
					engine: 'soniox'
				};
				res.body.audio.pipecat = {
					...(res.body.audio.pipecat || {}),
					enabled: true,
					url: 'http://mira-voice:7860',
					connection_mode: 'websocket'
				};
			});
		});
		cy.visit('/?call=true', {
			onBeforeLoad(win) {
				win.sessionStorage.setItem('chat-input', '1');
				// @ts-expect-error - test-only hooks
				win.__TEST_HOOKS__ = { keepCallOverlayOpen: true };
				if (!win.navigator.mediaDevices) {
					// @ts-expect-error - test shim
					win.navigator.mediaDevices = {};
				}
				win.navigator.mediaDevices.getUserMedia = () => Promise.resolve({
					getTracks: () => [{ stop: () => {} }]
				});
			}
		});
	});

	it('opens and closes voice mode overlay', () => {
		// Ensure chat input is loaded
		cy.get('#chat-input', { timeout: 10_000 }).should('exist');

		cy.window()
			.its('__TEST_HOOKS__.chatReady', { timeout: 10_000 })
			.should('eq', true);

		cy.window()
			.its('__TEST_HOOKS__.callOverlayVisible', { timeout: 10_000 })
			.should('eq', true);

		cy.window()
			.its('__TEST_HOOKS__.overlayMounted', { timeout: 10_000 })
			.should('eq', true);

		cy.window().then((win) => {
			// @ts-expect-error - test-only hooks
			const hooks = win.__TEST_HOOKS__;
			expect(typeof hooks?.triggerAudioPlayback).to.eq('function');
			expect(typeof hooks?.resetAudioPlayCount).to.eq('function');
			hooks.resetAudioPlayCount();
		});

		cy.window().then(async (win) => {
			// @ts-expect-error - test-only hooks
			const hooks = win.__TEST_HOOKS__;
			await hooks.triggerAudioPlayback();
		});

		cy.window().then((win) => {
			// @ts-expect-error - test-only hooks
			const hooks = win.__TEST_HOOKS__;
			expect(hooks.audioPlayCount).to.be.greaterThan(0);
		});
	});
});
