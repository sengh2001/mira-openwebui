// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../support/index.d.ts" />

describe('Classroom Teacher Toolbar', () => {
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
				res.body.audio.pipecat = {
					...(res.body.audio.pipecat || {}),
					url: 'http://mira-voice:7860'
				};
			});
		});
	});

	/**
	 * Helper: navigate to classroom and wait for lobby to load.
	 */
	function goToLobby() {
		cy.visit('/classroom');
		cy.contains('Classroom', { timeout: 10_000 }).should('exist');
		// eslint-disable-next-line cypress/no-unnecessary-waiting
		cy.wait(2000);
	}

	/**
	 * Helper: create a room via the API and return its room_id.
	 */
	function createRoomViaApi(name?: string): Cypress.Chainable<string> {
		const roomName = name || `CypressRoom-${Date.now()}`;
		return cy
			.request({
				method: 'POST',
				url: 'http://mira-voice:7860/classroom/rooms',
				qs: { name: roomName },
				failOnStatusCode: false
			})
			.then((resp) => {
				expect(resp.status).to.eq(200);
				return resp.body.room_id as string;
			});
	}

	/**
	 * Helper: join a SPECIFIC room by its name (clicks the card containing that name).
	 * This avoids joining the wrong room when multiple rooms exist.
	 */
	function joinRoomByName(roomName: string) {
		// Find the room card containing the room name and click it
		cy.contains(roomName, { timeout: 10_000 })
			.closest('[role="button"]')
			.click({ force: true });
	}

	/**
	 * Helper: wait for the active classroom view to load (speaker view).
	 */
	function waitForSpeakerView() {
		cy.contains('Release Mic', { timeout: 20_000 }).should('exist');
	}

	it('shows lobby with create room button and settings', () => {
		goToLobby();
		cy.contains('Create Room').should('exist');
		cy.contains('Your Settings').should('exist');
		cy.contains('Display Name').should('exist');
		cy.contains('Language').should('exist');
	});

	it('speaker sees teacher toolbar with action buttons', () => {
		const roomName = `ToolbarTest-${Date.now()}`;
		createRoomViaApi(roomName).then(() => {
			goToLobby();
			joinRoomByName(roomName);
			waitForSpeakerView();

			// First user to join becomes teacher. Teacher toolbar should be visible.
			cy.contains('Set Topic', { timeout: 15_000 }).should('exist');
			cy.contains('Quiz').should('exist');
			cy.contains('Summarize').should('exist');
		});
	});

	it('hides toolbar after releasing mic', () => {
		const roomName = `HideTest-${Date.now()}`;
		createRoomViaApi(roomName).then(() => {
			goToLobby();
			joinRoomByName(roomName);
			waitForSpeakerView();

			// Verify toolbar is there first
			cy.contains('Set Topic', { timeout: 15_000 }).should('exist');

			// Release mic; toolbar should hide
			cy.contains('Release Mic').click();
			cy.contains('Set Topic', { timeout: 10_000 }).should('not.exist');
		});
	});

	it('defaults to text mode for speaker (no auto-voice)', () => {
		const roomName = `TextMode-${Date.now()}`;
		createRoomViaApi(roomName).then(() => {
			goToLobby();
			joinRoomByName(roomName);
			waitForSpeakerView();

			// Should be in text mode by default
			cy.contains('Text', { timeout: 10_000 }).should('exist');
			// Voice mode should NOT be auto-started
			cy.contains('Connecting...').should('not.exist');
		});
	});

	it('listener sees Text Only / Text + Audio toggle after releasing mic', () => {
		const roomName = `ListenerTest-${Date.now()}`;
		createRoomViaApi(roomName).then(() => {
			goToLobby();
			joinRoomByName(roomName);
			waitForSpeakerView();

			// Release mic to become a listener
			cy.contains('Release Mic').click();

			// As a listener, should see the playback mode toggle
			cy.contains('Text Only', { timeout: 10_000 }).should('exist');
		});
	});
});
