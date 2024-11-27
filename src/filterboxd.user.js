// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.0.2
// @description  Filter titles on Letterboxd
// @author       Blake Gearin
// @match        https://letterboxd.com/*
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.js
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// @icon         https://raw.githubusercontent.com/blakegearin/filterboxd/main/img/logo.svg
// @supportURL   https://github.com/blakegearin/filterboxd/issues
// ==/UserScript==

/*global GM_config*/

(function() {
  'use strict';

  const SILENT = 0;
  const QUIET = 1;
  const INFO = 2;
  const DEBUG = 3;
  const VERBOSE = 4;
  const TRACE = 5;

  let CURRENT_LOG_LEVEL = INFO;

  const USERSCRIPT_NAME = 'Filterboxd';

  function log(level, message, variable = -1) {
    if (CURRENT_LOG_LEVEL < level) return;

    console.log(`${USERSCRIPT_NAME}: ${message}`);
    if (variable !== -1) console.log(variable);
  }

  function logError(message, variable = null) {
    console.error(`${USERSCRIPT_NAME}: ${message}`);
    if (variable) console.log(variable);
  }

  log(TRACE, 'Starting');

  function gmcInitialized() {
    log(DEBUG, 'gmcInitialized()');

    updateLogLevel();

    log(QUIET, 'Running');

    GMC.css.basic = '';

    applyFilters();

    let userscriptStyle = document.createElement('style');
    userscriptStyle.setAttribute('id', 'filterboxd-style');
    userscriptStyle.textContent += `
      .${SELECTORS.hiddenTitleClass}
      {
        ${GMC.get('hideStyle')}
      }
    `;
    document.body.appendChild(userscriptStyle);

    startObserving();
  }

  function updateLogLevel() {
    CURRENT_LOG_LEVEL = {
      'silent': SILENT,
      'quiet': QUIET,
      'debug': DEBUG,
      'verbose': VERBOSE,
      'trace': TRACE,
    }[GMC.get('logLevel')];
  }

  function startObserving() {
    log(DEBUG, 'startObserving()');

    OBSERVER.observe(
      document.body,
      {
        childList: true,
        subtree: true,
      },
    );
  }

  function modifyThenObserve(callback) {
    log(DEBUG, 'modifyThenObserve()');
    OBSERVER.disconnect();

    callback();

    startObserving();
  }

  function observeAndModify(mutationsList) {
    log(VERBOSE, 'observeAndModify()');

    if (IDLE_MUTATION_COUNT > MAX_IDLE_MUTATIONS) {
      // This is a failsafe to prevent infinite loops
      logError('MAX_IDLE_MUTATIONS exceeded');
      OBSERVER.disconnect();

      return;
    } else if (UPDATES_COUNT >= MAX_HEADER_UPDATES) {
      // This is a failsafe to prevent infinite loops
      logError('MAX_HEADER_UPDATES exceeded');
      OBSERVER.disconnect();

      return;
    }

    for (const mutation of mutationsList) {
      // Use header id to determine if updates have already been applied
      if (mutation.type !== 'childList') return;

      log(TRACE, 'mutation', mutation);

      const outcome = addHideToPopMenu();
      applyFilters();

      log(DEBUG, 'outcome', outcome);

      if (outcome === 'continue') continue;
      if (outcome === 'break') break;
    }
  }

  const MAX_IDLE_MUTATIONS = 1000;
  const MAX_HEADER_UPDATES = 100;

  let IDLE_MUTATION_COUNT = 0;
  let UPDATES_COUNT = 0;
  let SELECTORS = {
    processedClass: 'hide-processed',
    hiddenTitleClass: 'hidden-title',
    subnav: {
      subscriptionsListItem: '.main-nav .subnav [href="/settings/subscriptions/"]',
      filtersListItem: 'filtersListItem',
    },
    filmPosterPopMenu: {
      self: '.film-poster-popmenu',
      hideListItem: 'hideListItem',
      addToWatchlist: '.film-poster-popmenu .add-to-watchlist',
    },
  };

  function addFiltersToSubnav() {
    log(DEBUG, 'addFiltersToSubnav()');

    const subscriptionsListItem = document.querySelector(SELECTORS.subnav.subscriptionsListItem).parentElement;
    const filtersListItem = subscriptionsListItem.cloneNode(true);
    filtersListItem.setAttribute('id', SELECTORS.filtersListItem);

    const filtersLink = filtersListItem.firstElementChild;
    filtersLink.setAttribute('innerText', 'Filters');
    filtersLink.removeAttribute('href');

    subscriptionsListItem.parentNode.insertBefore(filtersListItem, subscriptionsListItem);
  }

  function addHideToPopMenu() {
    log(DEBUG, 'addHideToPopMenu()');

    const filmPosterPopMenus = document.querySelectorAll(SELECTORS.filmPosterPopMenu.self);

    if (!filmPosterPopMenus) {
      log(`Selector ${SELECTORS.filmPosterPopMenu.self} not found`, DEBUG);
      return 'break';
    }

    filmPosterPopMenus.forEach(filmPosterPopMenu => {
      const hideListItem = filmPosterPopMenu.querySelector(`.${SELECTORS.filmPosterPopMenu.hideListItem}`)
      if (hideListItem) return;

      const lastListItem = filmPosterPopMenu.querySelector('li:last-of-type');

      if (!lastListItem) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu} li:last-of-type not found`);
        return 'break';
      }

      modifyThenObserve(() => {
        const hideListItem = lastListItem.cloneNode(true);
        hideListItem.classList.add(SELECTORS.filmPosterPopMenu.hideListItem);
        hideListItem.onclick = () => {
          event.preventDefault();
          log('hideListItem clicked', DEBUG);

          const titleId = parseInt(event.target.getAttribute('data-film-id'));
          const titleSlug = event.target.getAttribute('data-film-slug');

          const titleMetadata = {
            id: titleId,
            slug: titleSlug,
          };

          hideTitle(titleMetadata);
          addToHiddenTitles(titleMetadata);
        };

        const hideLink = hideListItem.firstElementChild;
        hideLink.innerText = 'Hide with filters';

        const addToWatchlistLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addToWatchlist);

        if (!addToWatchlistLink) {
          logError(`Selector ${SELECTORS.filmPosterPopMenu.addToWatchlist} not found`);
          return 'break';
        }

        const titleId = addToWatchlistLink.getAttribute('data-film-id');
        hideLink.setAttribute('data-film-id', titleId);

        const slugMatch = /\/film\/([^/]+)\/add-to-watchlist\//;
        const titleSlug = addToWatchlistLink.getAttribute('data-action').match(slugMatch)?.[1];
        hideLink.setAttribute('data-film-slug', titleSlug);

        hideLink.removeAttribute('class');

        modifyThenObserve(() => {
          lastListItem.parentNode.append(hideListItem);
        });
      });
    });

    return;
  }

  function addToHiddenTitles(titleMetadata) {
    const hiddenTitles = getHiddenTitles();
    hiddenTitles.push(titleMetadata);

    GMC.set('hiddenTitles', JSON.stringify(hiddenTitles));
    GMC.save();

  }

  function applyFilters() {
    log(DEBUG, 'applyFilters()');

    const hiddenTitles = getHiddenTitles();
    hiddenTitles.forEach(titleMetadata => hideTitle(titleMetadata));
  }

  function getHiddenTitles() {
    return JSON.parse(GMC.get('hiddenTitles'));
  }

  function hideTitle({ id, slug }) {
    log(DEBUG, 'hideTitle()');

    const hideElement = (element, levelsUp = 0) => {
      let target = element;

      for (let i = 0; i < levelsUp; i++) {
        if (target.parentNode) {
          target = target.parentNode;
        } else {
          break;
        }
      }

      modifyThenObserve(() => {
        target.classList.add(SELECTORS.hiddenTitleClass);
      });
    };

    // Activity page reviews
    document.querySelectorAll(`section.activity-row [data-film-id="${id}"]`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(.${SELECTORS.processedClass})`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass);
    });

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]:not(.${SELECTORS.processedClass})`).forEach(posterElement => {
      hideElement(posterElement, 1);
      posterElement.classList.add(SELECTORS.processedClass);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${SELECTORS.processedClass})`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass);
    });

    // Popular with friends, competitions
    document.querySelectorAll(`div:not(.popmenu) [data-film-id="${id}"]:not(.${SELECTORS.processedClass})`).forEach(posterElement => {
      hideElement(posterElement, 0);
    });
  }

  addFiltersToSubnav();

  let OBSERVER = new MutationObserver(observeAndModify);

  let GMC = new GM_config({
    id: 'gmc-frame',
    events: {
      init: gmcInitialized,
    },
    fields: {
      hiddenTitles: {
        type: 'text',
        default: '',
      },
      hideStyle: {
        type: 'text',
        default: 'opacity: 0.1;',
      },
      logLevel: {
        label: 'Log level',
        type: 'select',
        options: [
          'silent',
          'quiet',
          'debug',
          'verbose',
          'trace',
        ],
        default: 'quiet',
      },
    },
  });
})();
