// Injected into the page context to expose window.gameData and handle updates
(() => {
  if (window.__colonistGameDataBridgeLoaded) return;
  window.__colonistGameDataBridgeLoaded = true;

  window.gameData = {
    opponents: {},
    opponentsLastUpdated: null,
    logs: [],
    logsLastUpdated: null,
    unprocessedLogs: [],
    unprocessedLogsLastUpdated: null,
    resources: {},
    resourcesLastUpdated: null
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'UPDATE_GAME_DATA') {
      const payload = event.data.payload || {};
      if (payload.opponentUsernames) {
        // backward compat: convert list to dict without resources
        const opp = {};
        payload.opponentUsernames.forEach((name) => {
          opp[name] = { resources: {} };
        });
        window.gameData.opponents = opp;
        window.gameData.opponentsLastUpdated = payload.opponentsLastUpdated || payload.lastUpdated || null;
      }
      if (payload.opponents) {
        window.gameData.opponents = payload.opponents;
        window.gameData.opponentsLastUpdated = payload.opponentsLastUpdated || payload.lastUpdated || null;
      }
      if (payload.logs) {
        window.gameData.logs = payload.logs;
        window.gameData.logsLastUpdated = payload.logsLastUpdated || payload.lastUpdated || null;
      }
      if (payload.unprocessedLogs) {
        window.gameData.unprocessedLogs = payload.unprocessedLogs;
        window.gameData.unprocessedLogsLastUpdated = payload.unprocessedLogsLastUpdated || payload.lastUpdated || null;
      }
      if (payload.resources) {
        window.gameData.resources = payload.resources;
        window.gameData.resourcesLastUpdated = payload.resourcesLastUpdated || payload.lastUpdated || null;
      }
      console.log('[gameData updated]', window.gameData);
    }

    if (event.data?.type === 'REQUEST_GAME_DATA') {
      window.postMessage({
        type: 'RESPONSE_GAME_DATA',
        payload: window.gameData
      }, '*');
    }
  });
})();
