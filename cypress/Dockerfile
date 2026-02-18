# Cypress E2E test runner for MIRA UI
# Uses official Cypress Docker image with Chrome pre-installed
FROM cypress/included:13.15.2

WORKDIR /app

# Copy package files for dependency install
COPY package.json package-lock.json ./

# Install only the dependencies Cypress needs (skip full npm install)
RUN npm ci --ignore-scripts

# Copy Cypress config and tests
COPY cypress.config.ts ./
COPY cypress/ ./cypress/

# Create a standalone tsconfig for Cypress (the main one extends .svelte-kit which doesn't exist here)
RUN echo '{ \
  "compilerOptions": { \
    "target": "ES2020", \
    "module": "ESNext", \
    "moduleResolution": "node", \
    "allowJs": true, \
    "esModuleInterop": true, \
    "forceConsistentCasingInFileNames": true, \
    "resolveJsonModule": true, \
    "skipLibCheck": true, \
    "sourceMap": true, \
    "strict": true, \
    "types": ["cypress"] \
  }, \
  "include": ["cypress/**/*.ts"] \
}' > tsconfig.json

# Override Cypress tsconfig to not extend the parent
RUN echo '{ \
  "compilerOptions": { \
    "target": "ES2020", \
    "module": "ESNext", \
    "moduleResolution": "node", \
    "inlineSourceMap": true, \
    "sourceMap": false, \
    "types": ["cypress"] \
  }, \
  "include": ["./**/*.ts"] \
}' > cypress/tsconfig.json

# Default: run all MIRA-specific E2E tests (using Electron, bundled with Cypress)
ENTRYPOINT ["cypress", "run", "--browser", "electron"]
CMD ["--spec", "cypress/e2e/classroom_teacher.cy.ts,cypress/e2e/tutor_voice.cy.ts"]
