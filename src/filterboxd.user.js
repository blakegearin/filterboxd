// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.0.1
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

  function createId(string) {
    log(TRACE, 'createId()');

    if (string.startsWith('#')) return string;

    if (string.startsWith('.')) {
      logError(`Attempted to create an id from a class: "${string}"`);
      return;
    }

    if (string.startsWith('[')) {
      logError(`Attempted to create an id from an attribute selector: "${string}"`);
      return;
    }

    return `#${string}`;
  }

  log(TRACE, 'Starting');

  function gmcInitialized() {
    log(DEBUG, 'gmcInitialized()');

    updateLogLevel();

    log(QUIET, 'Running');

    GMC.css.basic = '';

    applyFilters();
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
    subnav: {
      subscriptionsListItem: '.main-nav .subnav [href="/settings/subscriptions/"]',
      filtersListItem: 'filtersListItem',
    },
    filmPosterPopMenu: {
      self: '.film-poster-popmenu',
      hideListItem: 'hideListItem',
      addThisFilm: '.film-poster-popmenu .menu-item-add-this-film',
    },
  };

  function applyFilters() {
    log(DEBUG, 'applyFilters()');

    GMC.get('hiddenTitles').split(',').forEach(id => hideTitle(id));
  }

  function applyHideStyle(element) {
    element.style.cssText += GMC.get('hideStyle');
  }

  function hideTitle(id) {
    log(DEBUG, 'hideTitle()');

    const processedClass = 'hide-processed';

    const hideElement = (element, levelsUp = 0) => {
      let target = element;
      for (let i = 0; i < levelsUp; i++) {
        if (target.parentNode) {
          target = target.parentNode;
        } else {
          break;
        }
      }

      applyHideStyle(target);
    };

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]`).forEach(film => {
      hideElement(film, 1);
      film.classList.add(processedClass);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${processedClass})`).forEach(film => {
      hideElement(film, 3);
      film.classList.add(processedClass);
    });

    // Popular with friends, competitions
    document.querySelectorAll(`[data-film-id="${id}"]:not(.${processedClass})`).forEach(film => {
      hideElement(film, 0);
    });
  }

  function addFiltersToSubnav() {
    log(DEBUG, 'addFiltersToSubnav()');

    const subscriptionsListItem = document.querySelector(SELECTORS.subnav.subscriptionsListItem).parentElement;
    const filtersListItem = subscriptionsListItem.cloneNode(true);
    filtersListItem.id = SELECTORS.filtersListItem;

    const filtersLink = filtersListItem.firstElementChild;
    filtersLink.innerText = 'Filters';
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
          hideTitle(titleId);

          const hiddenTitles = GMC.get('hiddenTitles').split(',').filter(Boolean);
          hiddenTitles.push(titleId);

          GMC.set('hiddenTitles', hiddenTitles.join(','));
          GMC.save();
        };

        const hideLink = hideListItem.firstElementChild;
        hideLink.innerText = 'Hide with filters';

        const addThisFilmLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addThisFilm)

        if (!addThisFilmLink) {
          logError(`Selector ${SELECTORS.filmPosterPopMenu.addThisFilm} not found`);
          return 'break';
        }

        const titleId = addThisFilmLink.getAttribute('data-film-id');
        hideLink.setAttribute('data-film-id', titleId);
        hideLink.removeAttribute('class');

        lastListItem.parentNode.append(hideListItem);
      });
    });

    return;
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
