/// <reference types="cypress" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../support/index.d.ts" />

export const adminUser = {
	name: 'Admin User',
	email: 'admin@example.com',
	password: 'password'
};

const login = (email: string, password: string) => {
	return cy.session(
		email,
		() => {
			// Make sure to test against us english to have stable tests,
			// regardless on local language preferences
			localStorage.setItem('locale', 'en-US');
			// Visit auth page
			cy.visit('/auth');
			cy.get('body').then(($body) => {
				// If auth is enabled, complete login
				if ($body.find('input[autocomplete="email"]').length > 0) {
					cy.get('input[autocomplete="email"]').type(email);
					cy.get('input[type="password"]').type(password);
					cy.get('button[type="submit"]').click();
					cy.get('#chat-search').should('exist');
					if (localStorage.getItem('version') === null) {
						cy.get('button').contains("Okay, Let's Go!").click();
					}
					return;
				}
				// Auth disabled: just continue
				cy.visit('/');
			});
		},
		{
			validate: () => {
				const token = localStorage.getItem('token');
				if (!token) return;
				cy.request({
					method: 'GET',
					url: '/api/v1/auths/',
					headers: {
						Authorization: 'Bearer ' + token
					},
					failOnStatusCode: false
				}).then((response) => {
					expect(response.status).to.be.oneOf([200, 401, 403]);
				});
			}
		}
	);
};

const register = (name: string, email: string, password: string) => {
	return cy
		.request({
			method: 'POST',
			url: '/api/v1/auths/signup',
			body: {
				name: name,
				email: email,
				password: password
			},
			failOnStatusCode: false
		})
		.then((response) => {
			// 403 can occur when signups are disabled in deployed configs.
			expect(response.status).to.be.oneOf([200, 400, 403]);
		});
};

const registerAdmin = () => {
	return register(adminUser.name, adminUser.email, adminUser.password);
};

const loginAdmin = () => {
	return login(adminUser.email, adminUser.password);
};

Cypress.Commands.add('login', (email, password) => login(email, password));
Cypress.Commands.add('register', (name, email, password) => register(name, email, password));
Cypress.Commands.add('registerAdmin', () => registerAdmin());
Cypress.Commands.add('loginAdmin', () => loginAdmin());

before(() => {
	cy.registerAdmin();
});
