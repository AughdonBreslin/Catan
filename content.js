// Content script that observes the ui-game div on colonist.io

// Inject a bridge script via src to avoid CSP issues and expose window.gameData in the page context
const injectedScript = document.createElement('script');
injectedScript.src = chrome.runtime.getURL('page-bridge.js');
document.documentElement.appendChild(injectedScript);
injectedScript.remove();

const OPPONENTS_POLL_INTERVAL_MS = 1000;
let opponentsPollId = null;
let opponentsReady = false;
const logsCache = new Map(); // index -> { text, processed }
const resourcesState = new Map(); // player -> resource counts

// Function to extract opponent usernames
function extractOpponentUsernames() {
  const usernames = [];
  
  // Find the opponents scroll container using regex pattern
  const opponentsContainer = document.querySelector('[class*="opponentsScrollContainerScrollContent-"]');
  
  if (!opponentsContainer) {
    // console.log('[opponents] container not found');
    return usernames;
  }
//   console.log('[opponents] container found');
  
  // Find all opponent player rows
  const playerRows = opponentsContainer.querySelectorAll('[class*="opponentPlayerRow-"]');
//   console.log('[opponents] rows found:', playerRows.length);
  
  playerRows.forEach((row) => {
    // Find the username div within this row
    const usernameDiv = row.querySelector('[class*="username-"]');
    
    if (usernameDiv) {
      const username = usernameDiv.textContent.trim();
      usernames.push(username);
    }
  });
//   console.log('[opponents] extracted usernames:', usernames);
  
  return usernames;
}

function buildOpponentsObject(usernames = []) {
  const opp = {};
  const seen = new Set(usernames);
  usernames.forEach((name) => {
    const res = ensurePlayerResources(name);
    opp[name] = { resources: { ...res } };
  });
  // include any players that appeared via logs even if not in usernames list
  resourcesState.forEach((res, player) => {
    if (seen.has(player)) return;
    opp[player] = { resources: { ...res } };
  });
  return opp;
}

function publishOpponents(usernames = []) {
  const payload = {
    type: 'UPDATE_GAME_DATA',
    payload: {
      opponents: buildOpponentsObject(usernames),
      opponentsLastUpdated: new Date().toISOString()
    }
  };
//   console.log('[opponents] publishing', payload);
  window.postMessage(payload, '*');
}

function publishGameLogs(logEntries) {
  const unprocessed = logEntries.filter(entry => !entry.processed);
  const payload = {
    type: 'UPDATE_GAME_DATA',
    payload: {
      logs: logEntries,
      logsLastUpdated: new Date().toISOString(),
      unprocessedLogs: unprocessed,
      unprocessedLogsLastUpdated: new Date().toISOString()
    }
  };
//   console.log('[logs] publishing', payload);
  window.postMessage(payload, '*');
}

function getFeedScroller() {
  const gameDiv = document.getElementById('ui-game');
  if (!gameDiv) return null;
  const feedContainer = gameDiv.querySelector('[class*="responsiveContainer-"][class*="gameFeedsContainer-"]');
  if (!feedContainer) return null;
  const beigeContainer = feedContainer.querySelector('[class*="container-"][class*="beige-"]');
  if (!beigeContainer) return null;
  return beigeContainer.querySelector('[class*="virtualScroller-"]');
}

function extractGameLogs() {
  const scroller = getFeedScroller();
  if (!scroller) {
    // console.log('[logs] feed scroller not found');
    return [];
  }

  const items = scroller.querySelectorAll('[data-index]');
  const latestVisible = [];
  const newlyCached = [];

  items.forEach((item) => {
    const messageSpan = item.querySelector('[class*="scrollItemContainer-"] [class*="feedMessage-"] [class*="messagePart-"]');
    if (!messageSpan) return;
    const indexAttr = item.getAttribute('data-index');
    const idx = indexAttr ? Number(indexAttr) : null;
    if (idx === null || Number.isNaN(idx)) return;

    const text = buildLogMessage(messageSpan);
    const existing = logsCache.get(idx);
    const processed = existing?.processed || false;
    const entry = { text, processed };
    latestVisible.push({ index: idx, text, processed });
    if (!existing) {
      newlyCached.push({ index: idx, text, processed });
    }
    logsCache.set(idx, entry);
  });

  const merged = Array.from(logsCache.entries())
    .map(([index, entry]) => ({ index, text: entry.text, processed: !!entry.processed }))
    .sort((a, b) => a.index - b.index);

//   console.log(`[logs] visible now: ${latestVisible.length}, cached total: ${merged.length}`);

  // Attempt processing immediately for newly cached entries
  if (newlyCached.length > 0) {
    processLogsForResources(newlyCached);
  }

  return merged;
}

const RESOURCE_ALTS = new Set(['Lumber', 'Brick', 'Wool', 'Grain', 'Ore']);
const DICE_ALTS = new Set(['dice_1', 'dice_2', 'dice_3', 'dice_4', 'dice_5', 'dice_6']);
const CARD_ALTS = new Set(['Development Card', 'Resource Card']);

function buildLogMessage(spanEl) {
  const parts = [];
  spanEl.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) parts.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'IMG') {
        const alt = node.getAttribute('alt');
        if (RESOURCE_ALTS.has(alt) || DICE_ALTS.has(alt) || CARD_ALTS.has(alt)) {
          parts.push(alt);
        }
      } else {
        const innerText = node.textContent.trim();
        if (innerText) parts.push(innerText);
      }
    }
  });
  return parts.join(' ');
}

const RESOURCE_KEYS = ['Lumber', 'Brick', 'Wool', 'Grain', 'Ore'];

function ensurePlayerResources(player) {
  if (!resourcesState.has(player)) {
    if (player === 'Bank') {
      initializeBank();
      return resourcesState.get('Bank');
    }
    const zeroed = Object.fromEntries(RESOURCE_KEYS.map((r) => [r, 0]));
    if (player !== 'PieEater') {
      zeroed.UnknownLost = 0;
      zeroed.UnknownStole = 0;
    }
    resourcesState.set(player, zeroed);
  }
  return resourcesState.get(player);
}

function initializeBank() {
  if (!resourcesState.has('Bank')) {
    const bankResources = Object.fromEntries(RESOURCE_KEYS.map((r) => [r, 19]));
    resourcesState.set('Bank', bankResources);
  }
}

function publishResources() {
  const resourcesObj = {};
  resourcesState.forEach((vals, player) => {
    resourcesObj[player] = vals;
  });
  const payload = {
    type: 'UPDATE_GAME_DATA',
    payload: {
      resources: resourcesObj,
      resourcesLastUpdated: new Date().toISOString()
    }
  };
  console.log('[resources] publishing', payload);
  window.postMessage(payload, '*');
}

function parseStartingResources(text) {
  const lower = text.toLowerCase();
  if (!lower.includes('received starting resources')) return null;

  const [playerPart, restPart] = text.split(/received starting resources/i);
  const player = playerPart ? playerPart.trim() : '';
  if (!player) return null;

  // Try to capture everything after the colon or the split point
  const resourceSection = restPart ? restPart.replace(/^:/, '').trim() : '';
  if (!resourceSection) return { player, resources: [] };

  const tokens = resourceSection.split(/\s+/);
  const resources = tokens.filter((tok) => RESOURCE_ALTS.has(tok));
  return { player, resources };
}

function parseTookResources(text) {
  const match = text.match(/^(.*?)\s+took\s+from\s+bank\s+(.*)$/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;
  const remainder = match[2].trim();
  if (!remainder) return { player, resources: [] };

  const resources = parseResourceList(remainder);
  return { player, resources };
}

function parseGotResources(text) {
  const match = text.match(/^(.*?)\s+got\s+(.*)$/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;

  const remainder = match[2].trim();
  if (!remainder) return { player, resources: [] };

  const tokens = remainder.split(/\s+/);
  const resources = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const cleaned = raw.replace(/[.,:;]/g, '');
    const asNum = Number(cleaned);
    if (!Number.isNaN(asNum) && asNum > 0 && i + 1 < tokens.length) {
      const nextTok = tokens[i + 1].replace(/[.,:;]/g, '');
      if (RESOURCE_ALTS.has(nextTok)) {
        resources.push({ name: nextTok, count: asNum });
        i += 1; // consume next token
        continue;
      }
    }
    if (RESOURCE_ALTS.has(cleaned)) {
      resources.push({ name: cleaned, count: 1 });
    }
  }

  return { player, resources };
}

function parseTradeResources(text) {
  // Format: <trader> gave <list> and got <list> from <tradee>
  const match = text.match(/^(.*?)\s+gave\s+(.*?)\s+and\s+got\s+(.*?)\s+from\s+(.*)$/i);
  if (!match) return null;
  const trader = match[1] ? match[1].trim() : '';
  const gaveStr = match[2] ? match[2].trim() : '';
  const gotStr = match[3] ? match[3].trim() : '';
  const tradee = match[4] ? match[4].trim() : '';
  if (!trader || !tradee) return null;

  const gave = parseResourceList(gaveStr);
  const got = parseResourceList(gotStr);
  return { trader, tradee, gave, got };
}

function parseBoughtDevelopmentCard(text) {
  const match = text.match(/^(.*?)\s+bought\s+Development Card/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;
  return { player };
}

function parseBuiltRoad(text) {
  const match = text.match(/^(.*?)\s+built a Road/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;
  return { player };
}

function parseBuiltSettlement(text) {
  const match = text.match(/^(.*?)\s+built a Sett/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;
  return { player };
}

function parseBuiltCity(text) {
  const match = text.match(/^(.*?)\s+built a City/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  if (!player) return null;
  return { player };
}

function parseGaveBank(text) {
  const match = text.match(/^(.*?)\s+gave bank\s+(.*?)\s+and took\s+(.*)$/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  const gaveStr = match[2] ? match[2].trim() : '';
  const tookStr = match[3] ? match[3].trim() : '';
  if (!player) return null;

  const gave = parseResourceList(gaveStr);
  const took = parseResourceList(tookStr);
  return { player, gave, took };
}

function parseStoleResource(text) {
  // Format: <robber> stole <resource or Resource Card> from <victim>
  const match = text.match(/^(.*?)\s+stole\s+(.*?)\s+from\s+(.*)$/i);
  if (!match) return null;
  let robber = match[1] ? match[1].trim() : '';
  const resourceStr = match[2] ? match[2].trim() : '';
  let victim = match[3] ? match[3].trim() : '';
  if (!robber || !victim) return null;

  // Replace "You" or "you" with "PieEater"
  if (robber.toLowerCase() === 'you') {
    robber = 'PieEater';
  }
  if (victim.toLowerCase() === 'you') {
    victim = 'PieEater';
  }

  // resourceStr should be either a resource name or "Resource Card"
  let resource = null;
  if (RESOURCE_ALTS.has(resourceStr)) {
    resource = resourceStr;
  } else if (resourceStr === 'Resource Card') {
    resource = 'Resource Card';
  }

  return { robber, victim, resource };
}

function parseDiscardedResources(text) {
  // Format: <player> discarded <resources>
  const match = text.match(/^(.*?)\s+discarded\s+(.*)$/i);
  if (!match) return null;
  const player = match[1] ? match[1].trim() : '';
  const discardedStr = match[2] ? match[2].trim() : '';
  if (!player) return null;

  const discarded = parseResourceList(discardedStr);
  return { player, discarded };
}

function parseResourceList(str) {
  const tokens = str.split(/\s+/);
  const resources = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const cleaned = tokens[i].replace(/[.,:;]/g, '');
    if (!cleaned) continue;
    const num = Number(cleaned);
    if (!Number.isNaN(num) && num > 0 && i + 1 < tokens.length) {
      const next = tokens[i + 1].replace(/[.,:;]/g, '');
      if (RESOURCE_ALTS.has(next)) {
        resources.push({ name: next, count: num });
        i += 1;
        continue;
      }
    }
    if (RESOURCE_ALTS.has(cleaned)) {
      resources.push({ name: cleaned, count: 1 });
    }
  }
  return resources;
}

function parseExtraneousPatterns(text) {
  const lower = text.toLowerCase();
  // Intro messages
  if (lower.includes('happy settling! learn how to play in the rulebook')) {
    return { type: 'extraneous', reason: 'rulebook message' };
  }
  if (lower.includes('placed a')) {
    return { type: 'extraneous', reason: 'placement message' };
  }
  if (lower.includes('bot is placing a')) {
    return { type: 'extraneous', reason: 'bot placement message' };
  }

  // System messages
  if (lower === '') {
    return { type: 'extraneous', reason: 'spacer message' };
  }
  if (lower.includes('disconnected')) {
    return { type: 'extraneous', reason: 'disconnect message' };
  }
  if (lower.includes('reconnected')) {
    return { type: 'extraneous', reason: 'reconnect message' };
  }

  // Game action messages
  if (lower.includes('rolled')) {
    return { type: 'extraneous', reason: 'dice roll message' };
  }
  if (lower.includes('wants to give')) {
    return { type: 'extraneous', reason: 'trade offer message' };
  }
  if (lower.includes('proposed counter offer')) {
    return { type: 'extraneous', reason: 'trade counter offer message' };
  }
  if (lower.includes('bot is selecting cards to discard for')) {
    return { type: 'extraneous', reason: 'bot discard message' };
  }

  // Robber messages
  if (lower.includes('friendly robber is active')) {
    return { type: 'extraneous', reason: 'friendly robber message' };
  }
  if (lower.includes("no player to steal from")) {
    return { type: 'extraneous', reason: 'no steal available message' };
  }
  if (lower.includes("moved robber to")) {
    return { type: 'extraneous', reason: 'move robber message' };
  }
  if (lower.includes("bot is selecting where to place robber for")) {
    return { type: 'extraneous', reason: 'bot move robber message' };
  }
  if (lower.includes("is blocked by the robber. no resources produced")) {
    return { type: 'extraneous', reason: 'robber block message' };
  }

  // Development card messages
  if (lower.includes('used')) {
    return { type: 'extraneous', reason: 'used development card message' };
  }

  // Longest road / largest army messages
  if (lower.includes('longest road')) {
    return { type: 'extraneous', reason: 'longest road message' };
  }
  if (lower.includes('largest army')) {
    return { type: 'extraneous', reason: 'largest army message' };
  }

  // End of game message
  if (lower.includes('won the game!')) {
    return { type: 'extraneous', reason: 'game won message' };
  }
  return null;
}

function classifyResourceLog(text) {
  const startParsed = parseStartingResources(text);
  if (startParsed && startParsed.resources.length > 0) {
    return { type: 'startingResources', data: startParsed };
  }

  const tookParsed = parseTookResources(text);
  if (tookParsed && tookParsed.resources.length > 0) {
    return { type: 'gotResources', data: tookParsed };
  }

  const tradeParsed = parseTradeResources(text);
  if (tradeParsed && (tradeParsed.gave.length > 0 || tradeParsed.got.length > 0)) {
    return { type: 'tradeResources', data: tradeParsed };
  }

  const boughtCardParsed = parseBoughtDevelopmentCard(text);
  if (boughtCardParsed) {
    return { type: 'boughtDevelopmentCard', data: boughtCardParsed };
  }

  const builtRoadParsed = parseBuiltRoad(text);
  if (builtRoadParsed) {
    return { type: 'builtRoad', data: builtRoadParsed };
  }

  const builtSettlementParsed = parseBuiltSettlement(text);
  if (builtSettlementParsed) {
    return { type: 'builtSettlement', data: builtSettlementParsed };
  }

  const builtCityParsed = parseBuiltCity(text);
  if (builtCityParsed) {
    return { type: 'builtCity', data: builtCityParsed };
  }

  const gaveBankParsed = parseGaveBank(text);
  if (gaveBankParsed && (gaveBankParsed.gave.length > 0 || gaveBankParsed.took.length > 0)) {
    return { type: 'gaveBank', data: gaveBankParsed };
  }

  const stoleResourceParsed = parseStoleResource(text);
  if (stoleResourceParsed) {
    console.log('[parse] stole resource detected:', stoleResourceParsed);
    return { type: 'stoleResource', data: stoleResourceParsed };
  }

  const discardedParsed = parseDiscardedResources(text);
  if (discardedParsed && discardedParsed.discarded.length > 0) {
    return { type: 'discardedResources', data: discardedParsed };
  }

  const gotParsed = parseGotResources(text);
  if (gotParsed && gotParsed.resources.length > 0) {
    return { type: 'gotResources', data: gotParsed };
  }

  const extraneousParsed = parseExtraneousPatterns(text);
  if (extraneousParsed) {
    return extraneousParsed;
  }
  return null;
}

function processLogsForResources(logs) {
  let updated = false;
  logs.forEach((entry) => {
    const cacheEntry = logsCache.get(entry.index);
    if (cacheEntry?.processed) return;

    const classified = classifyResourceLog(entry.text);
    if (!classified) return;

    switch (classified.type) {
      case 'startingResources': {
        const { player, resources } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        resources.forEach((res) => {
          store[res] += 1;
          bankStore[res] -= 1;
        });
        updated = true;
        console.log('[resources] applied starting resources', player, resources, '=>', store);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'tookResources': {
        const { player, resources } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        resources.forEach(({ name, count }) => {
          store[name] += count;
          bankStore[name] -= count;
        });
        updated = true;
        console.log('[resources] applied took resources', player, resources, '=>', store, 'Bank =>', bankStore);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'gotResources': {
        const { player, resources } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        resources.forEach(({ name, count }) => {
          store[name] += count;
          bankStore[name] -= count;
        });
        updated = true;
        console.log('[resources] applied got resources', player, resources, '=>', store, 'Bank =>', bankStore);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'tradeResources': {
        const { trader, tradee, gave, got } = classified.data;
        const traderStore = ensurePlayerResources(trader);
        const tradeeStore = ensurePlayerResources(tradee);

        // Trader gives: subtract from trader, add to tradee
        gave.forEach(({ name, count }) => {
          traderStore[name] -= count;
          tradeeStore[name] += count;
        });

        // Trader gets: add to trader, subtract from tradee
        got.forEach(({ name, count }) => {
          traderStore[name] += count;
          tradeeStore[name] -= count;
        });

        updated = true;
        console.log('[resources] applied trade', { trader, tradee, gave, got, traderStore, tradeeStore });
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'boughtDevelopmentCard': {
        const { player } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Buying dev card costs: 1 Wool, 1 Grain, 1 Ore
        store['Wool']  -= 1; bankStore['Wool']  += 1;
        store['Grain'] -= 1; bankStore['Grain'] += 1;
        store['Ore']   -= 1; bankStore['Ore']   += 1;
        
        updated = true;
        console.log('[resources] applied bought development card', player, '=>', store);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'builtRoad': {
        const { player } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Building a road costs: 1 Lumber, 1 Brick
        store['Lumber'] -= 1; bankStore['Lumber'] += 1;
        store['Brick']  -= 1; bankStore['Brick']  += 1;
        
        updated = true;
        console.log('[resources] applied built road', player, '=>', store);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'builtSettlement': {
        const { player } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Building a settlement costs: 1 Lumber, 1 Brick, 1 Wool, 1 Grain
        store['Lumber'] -= 1; bankStore['Lumber'] += 1;
        store['Brick']  -= 1; bankStore['Brick']  += 1;
        store['Wool']   -= 1; bankStore['Wool']   += 1;
        store['Grain']  -= 1; bankStore['Grain']  += 1;
        
        updated = true;
        console.log('[resources] applied built settlement', player, '=>', store);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'builtCity': {
        const { player } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Building a city costs: 3 Ore, 2 Grain
        store['Ore']   -= 3; bankStore['Ore']   += 3;
        store['Grain'] -= 2; bankStore['Grain'] += 2;
        
        updated = true;
        console.log('[resources] applied built city', player, '=>', store);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'gaveBank': {
        const { player, gave, took } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Subtract what they gave to the bank
        gave.forEach(({ name, count }) => {
          store[name] -= count;
          bankStore[name] += count;
        });
        
        // Add what they took from the bank
        took.forEach(({ name, count }) => {
          store[name] += count;
          bankStore[name] -= count;
        });
        
        updated = true;
        console.log('[resources] applied bank trade', player, { gave, took }, '=>', store, 'Bank =>', bankStore);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'stoleResource': {
        const { robber, victim, resource } = classified.data;
        
        // Only handle when we know the specific resource (not "Resource Card")
        if (resource && RESOURCE_ALTS.has(resource)) {
          const robberStore = ensurePlayerResources(robber);
          const victimStore = ensurePlayerResources(victim);
          
          // Transfer the resource from victim to robber
          victimStore[resource] -= 1;
          robberStore[resource] += 1;
          
          updated = true;
          console.log('[resources] applied rob', robber, 'stole', resource, 'from', victim, '=>', { robberStore, victimStore });
          logsCache.set(entry.index, { text: entry.text, processed: true });
        } else if (resource === 'Resource Card') {
          const robberStore = ensurePlayerResources(robber);
          const victimStore = ensurePlayerResources(victim);
          
          // Track unknown resource transfers
          robberStore.UnknownStole += 1;
          victimStore.UnknownLost += 1;
          
          updated = true;
          console.log('[resources] applied unknown rob', robber, 'stole unknown from', victim, '=>', { robberStore, victimStore });
          logsCache.set(entry.index, { text: entry.text, processed: true });
        } else {
          console.log('[resources] untracked robbery?', { robber, victim, resource });
        }
        break;
      }
      case 'discardedResources': {
        const { player, discarded } = classified.data;
        const store = ensurePlayerResources(player);
        const bankStore = ensurePlayerResources('Bank');
        
        // Remove discarded resources from player and add them back to bank
        discarded.forEach(({ name, count }) => {
          store[name] -= count;
          bankStore[name] += count;
        });
        
        updated = true;
        console.log('[resources] applied discarded', player, discarded, '=>', store, 'Bank =>', bankStore);
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      case 'extraneous': {
        // Just mark as processed
        logsCache.set(entry.index, { text: entry.text, processed: true });
        break;
      }
      default:
        break;
    }
  });
  if (updated) {
    publishResources();
    // also refresh opponents to reflect updated resources
    publishOpponents(extractOpponentUsernames());
  }
}

// Poll until opponents container appears, then extract once to seed state
function startOpponentsPoll() {
  if (opponentsPollId) {
    clearInterval(opponentsPollId);
  }
  opponentsPollId = setInterval(() => {
    if (opponentsReady) {
      clearInterval(opponentsPollId);
      opponentsPollId = null;
      return;
    }
    const usernames = extractOpponentUsernames();
    if (usernames.length === 0) {
    //   console.log('[poll] opponents not ready yet');
      return;
    }
    opponentsReady = true;
    // console.log('[poll] opponents ready, seeding gameData');
    publishOpponents(usernames);
  }, OPPONENTS_POLL_INTERVAL_MS);
}

// MutationObserver to watch for changes in the ui-game div
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    const opponentsContainer = document.querySelector('[class*="opponentsScrollContainerScrollContent-"]');
    const feedScroller = getFeedScroller();
    
    if (mutation.type === 'childList') {
      if (mutation.addedNodes.length > 0) {
        // console.log('Nodes added:', mutation.addedNodes);
      }
      if (mutation.removedNodes.length > 0) {
        // console.log('Nodes removed:', mutation.removedNodes);
      }
      
      // Check if the mutation is in the opponents container
      if (opponentsContainer && (mutation.target === opponentsContainer || mutation.target.closest('[class*="opponentsScrollContainerScrollContent-"]'))) {
        // console.log('[observer] childList mutation in opponents area');
        const usernames = extractOpponentUsernames();
        publishOpponents(usernames);
        // console.log('Current opponents:', usernames);
      } else if (!opponentsContainer) {
        // console.log('[observer] childList mutation but opponents container not present yet');
      }

      // Check if the mutation is in the feed scroller (logs)
      if (feedScroller && feedScroller.contains(mutation.target)) {
        // console.log('[observer] childList mutation in feed scroller');
        const logs = extractGameLogs();
        publishGameLogs(logs);
        processLogsForResources(logs);
      } else if (!feedScroller) {
        // console.log('[observer] childList mutation but feed scroller not present yet');
      }
    } else if (mutation.type === 'attributes') {
    //   console.log(`Attribute "${mutation.attributeName}" changed on:`, mutation.target);
    //   console.log(`New value: "${mutation.target.getAttribute(mutation.attributeName)}"`);
      
      // Also check if the opponents container was just created/modified
      if (mutation.target.classList.contains('opponentPlayerRow')) {
        // console.log('[observer] attribute change on opponent row');
        const usernames = extractOpponentUsernames();
        publishOpponents(usernames);
        // console.log('Current opponents:', usernames);
      }
    } else if (mutation.type === 'characterData') {
    //   console.log('Text content changed:', {
    //     oldText: mutation.oldValue,
    //     newText: mutation.target.textContent
    //   });
    }
  });
});

// Wait for the DOM to be ready and start observing
function initializeObserver() {
  const gameDiv = document.getElementById('ui-game');
  
  if (gameDiv) {
    // console.log('Found ui-game div, starting observation...');
    
    // Configuration for the observer
    const config = {
      childList: true,      // Watch for added/removed child nodes
      subtree: true,        // Watch all descendants
      attributes: true,     // Watch for attribute changes
      characterData: true,  // Watch for text content changes
      attributeFilter: ['class', 'data-*'] // Optimize by only watching specific attributes
    };
    
    observer.observe(gameDiv, config);
    console.log('Observer started on ui-game div');
    initializeBank();
    startOpponentsPoll();
  } else {
    console.log('ui-game div not found, retrying in 1000ms...');
    setTimeout(initializeObserver, 1000);
  }
}

// Start observing when the script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeObserver);
} else {
  initializeObserver();
}

// Extract and log initial opponent usernames if they exist
setTimeout(() => {
  const usernames = extractOpponentUsernames();
  if (usernames.length > 0) {
    publishOpponents(usernames);
    // console.log('Initial opponents:', usernames);
  } else {
    // console.log('Initial opponent usernames: none found yet');
  }

  const logs = extractGameLogs();
  if (logs.length > 0) {
    publishGameLogs(logs);
    processLogsForResources(logs);
    // console.log('Initial logs extracted:', logs.length);
  } else {
    // console.log('Initial logs: none found yet');
  }
}, 500);

// Send messages to the background script for logging or further processing
window.addEventListener('message', (event) => {
  // Only accept messages from our extension
  if (event.source !== window) return;
  
  if (event.data.type && event.data.type === 'GAME_DATA_UPDATE') {
    chrome.runtime.sendMessage({
      action: 'logGameData',
      data: event.data.payload
    });
  }
});

console.log('Colonist.io scraper content script loaded');
