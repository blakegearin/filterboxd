// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.2.0
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

  const RESET = false;

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

    if (RESET) {
      log(QUIET, 'Resetting GMC');
      GMC.set('hiddenTitles', JSON.stringify([]));
      GMC.reset();
      GMC.save();
    }

    let userscriptStyle = document.createElement('style');
    userscriptStyle.setAttribute('id', 'filterboxd-style');
    userscriptStyle.textContent += `
      .${SELECTORS.hiddenTitleClass}
      {
        ${GMC.get('hideStyle')}
      }

      .${SELECTORS.settings.hiddenTitleSpanClass}
      {
        cursor: pointer;
        margin-right: 0.3rem !important;
      }

      .${SELECTORS.settings.hiddenTitleSpanClass}:hover
      {
        background: #303840;
        color: #def;
      }
    `;
    document.body.appendChild(userscriptStyle);

    applyFilters();
    maybeAddConfigurationToSettings();

    startObserving();
  }

  function updateLogLevel() {
    CURRENT_LOG_LEVEL = {
      silent: SILENT,
      quiet: QUIET,
      info: INFO,
      debug: DEBUG,
      verbose: VERBOSE,
      trace: TRACE,
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

      const outcome = addListItemToPopMenu();
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
    filmPosterPopMenu: {
      self: '.film-poster-popmenu',
      userscriptListItemClass: 'userscriptListItem',
      addToWatchlist: '.film-poster-popmenu .add-to-watchlist',
      addThisFilm: '.film-poster-popmenu .menu-item-add-this-film',
    },
    hiddenTitleClass: 'hidden-title',
    processedClass: {
      hide: 'hide-processed',
      unhide: 'unhide-processed',
    },
    settings: {
      clear: '.clear',
      favoriteFilms: '.favourite-films-selector',
      hiddenTitleSpanClass: 'hidden-title-span',
      note: '.note',
      posterList: '.poster-list',
      subtitle: '.mob-subtitle',
    },
  };

  function maybeAddConfigurationToSettings() {
    log(DEBUG, 'maybeAddConfigurationToSettings()');

    const configurationId = 'filterboxd-configuration';
    const configurationExists = document.querySelector(configurationId);
    log(VERBOSE, 'configurationExists', configurationExists);

    const onSettingsPage = window.location.href.includes('/settings/');
    log(VERBOSE, 'onSettingsPage', onSettingsPage);

    if (!onSettingsPage || configurationExists) {
      log(DEBUG, 'Not on settings page or configuration is present');

      return;
    }

    log(DEBUG, 'On settings page and configuration not present');

    const favoriteFilmsDiv = document.querySelector(SELECTORS.settings.favoriteFilms);
    const userscriptConfigurationDiv = favoriteFilmsDiv.cloneNode(true);

    userscriptConfigurationDiv.setAttribute('id', configurationId);
    const posterList = userscriptConfigurationDiv.querySelector(SELECTORS.settings.posterList);
    posterList.remove();

    userscriptConfigurationDiv.setAttribute('style', 'margin-top: 4rem;');
    userscriptConfigurationDiv.querySelector(SELECTORS.settings.subtitle).innerText = 'Filtered Films';
    userscriptConfigurationDiv.querySelector(SELECTORS.settings.note).innerText = 'Click titles to remove.';

    const hiddenTitlesParagraph = document.createElement('p');
    let hiddenTitlesDiv = document.createElement('div');
    hiddenTitlesDiv.classList.add('text-sluglist');

    const hiddenTitles = getHiddenTitles();
    log(VERBOSE, 'hiddenTitles', hiddenTitles);

    hiddenTitles.forEach(hiddenTitle => {
      log(VERBOSE, 'hiddenTitle', hiddenTitle);

      let hiddenTitleSpan = document.createElement('span');

      hiddenTitleSpan.classList.add(
        'text-slug',
        SELECTORS.processedClass.hide,
        SELECTORS.settings.hiddenTitleSpanClass,
      );
      hiddenTitleSpan.setAttribute('data-film-id', hiddenTitle.id);
      hiddenTitleSpan.innerText = `${hiddenTitle.name} (${hiddenTitle.year})`;

      hiddenTitleSpan.onclick = () => {
        unhideTitle(hiddenTitle);
        removeFromHiddenTitles(hiddenTitle);
        hiddenTitleSpan.remove();
      };

      hiddenTitlesParagraph.appendChild(hiddenTitleSpan);
    });

    hiddenTitlesDiv.appendChild(hiddenTitlesParagraph);

    const clearDiv = userscriptConfigurationDiv.querySelector(SELECTORS.settings.clear);
    clearDiv.remove();

    userscriptConfigurationDiv.append(hiddenTitlesDiv);
    favoriteFilmsDiv.parentNode.insertBefore(userscriptConfigurationDiv, favoriteFilmsDiv.nextSibling);
  }

  function addListItemToPopMenu() {
    log(DEBUG, 'addListItemToPopMenu()');

    const filmPosterPopMenus = document.querySelectorAll(SELECTORS.filmPosterPopMenu.self);

    if (!filmPosterPopMenus) {
      log(`Selector ${SELECTORS.filmPosterPopMenu.self} not found`, DEBUG);
      return 'break';
    }

    filmPosterPopMenus.forEach(filmPosterPopMenu => {
      const userscriptListItem = filmPosterPopMenu.querySelector(`.${SELECTORS.filmPosterPopMenu.userscriptListItemClass}`);
      if (userscriptListItem) return;

      const lastListItem = filmPosterPopMenu.querySelector('li:last-of-type');

      if (!lastListItem) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu} li:last-of-type not found`);
        return 'break';
      }

      modifyThenObserve(() => {
        const userscriptListItem = lastListItem.cloneNode(true);
        userscriptListItem.classList.add(SELECTORS.filmPosterPopMenu.userscriptListItemClass);

        const userscriptLink = userscriptListItem.firstElementChild;
        userscriptListItem.onclick = (event) => {
          event.preventDefault();
          log(DEBUG, 'userscriptListItem clicked');

          const link = event.target;

          const id = parseInt(link.getAttribute('data-film-id'));
          const slug = link.getAttribute('data-film-slug');
          const name = link.getAttribute('data-film-name');
          const year = link.getAttribute('data-film-release-year');

          const titleMetadata = {
            id,
            slug,
            name,
            year,
          };

          const titleIsHidden = link.getAttribute('data-title-hidden') === 'true';
          if (titleIsHidden) {
            unhideTitle(titleMetadata);
            removeFromHiddenTitles(titleMetadata);
          } else {
            hideTitle(titleMetadata);
            addToHiddenTitles(titleMetadata);
          }

          updateLinkInPopMenu(!titleIsHidden, link);
        };

        const addToWatchlistLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addToWatchlist);

        if (!addToWatchlistLink) {
          logError(`Selector ${SELECTORS.filmPosterPopMenu.addToWatchlist} not found`);
          return 'break';
        }

        const titleId = parseInt(addToWatchlistLink.getAttribute('data-film-id'));
        userscriptLink.setAttribute('data-film-id', titleId);

        const slugMatch = /\/film\/([^/]+)\/add-to-watchlist\//;
        const titleSlug = addToWatchlistLink.getAttribute('data-action').match(slugMatch)?.[1];
        userscriptLink.setAttribute('data-film-slug', titleSlug);

        const addThisFilmLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addThisFilm);
        const titleName = addThisFilmLink.getAttribute('data-film-name');
        userscriptLink.setAttribute('data-film-name', titleName);
        const titleYear = addThisFilmLink.getAttribute('data-film-release-year');
        userscriptLink.setAttribute('data-film-release-year', titleYear);

        const titleIsHidden = getHiddenTitles().some(hiddenTitle => hiddenTitle.id === titleId);
        updateLinkInPopMenu(titleIsHidden, userscriptLink);

        userscriptLink.removeAttribute('class');

        lastListItem.parentNode.append(userscriptListItem);
      });
    });

    return;
  }

  function addToHiddenTitles(titleMetadata) {
    log(DEBUG, 'addToHiddenTitles()');

    const hiddenTitles = getHiddenTitles();
    hiddenTitles.push(titleMetadata);
    log(VERBOSE, 'hiddenTitles', hiddenTitles);

    GMC.set('hiddenTitles', JSON.stringify(hiddenTitles));
    GMC.save();
  }

  function applyFilters() {
    log(DEBUG, 'applyFilters()');

    const hiddenTitles = getHiddenTitles();
    log(VERBOSE, 'hiddenTitles', hiddenTitles);

    hiddenTitles.forEach(titleMetadata => hideTitle(titleMetadata));
  }

  function getHiddenTitles() {
    return JSON.parse(GMC.get('hiddenTitles'));
  }

  function hideElement(element, levelsUp = 0) {
    log(DEBUG, 'hideElement()');

    let target = element;

    for (let i = 0; i < levelsUp; i++) {
      if (target.parentNode) {
        target = target.parentNode;
      } else {
        break;
      }
    }

    log(VERBOSE, 'target', target);

    modifyThenObserve(() => {
      target.classList.add(SELECTORS.hiddenTitleClass);
    });
  }

  function hideTitle({ id, slug }) {
    log(DEBUG, 'hideTitle()');

    // Activity page reviews
    document.querySelectorAll(`section.activity-row [data-film-id="${id}"]`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      hideElement(posterElement, 1);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      hideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // TODO: Diary

    // Popular with friends, competitions
    const remainingElements = document.querySelectorAll(
      `div:not(.popmenu):not(.actions-panel) [data-film-id="${id}"]:not(aside [data-film-id="${id}"]):not(.${SELECTORS.processedClass.hide})`,
    );
    remainingElements.forEach(posterElement => {
      hideElement(posterElement, 0);
    });
  }

  function removeFromHiddenTitles(titleMetadata) {
    let hiddenTitles = getHiddenTitles();
    hiddenTitles = hiddenTitles.filter(hiddenTitle => hiddenTitle.id !== titleMetadata.id);

    GMC.set('hiddenTitles', JSON.stringify(hiddenTitles));
    GMC.save();
  }

  function unhideElement(element, levelsUp = 0) {
    log(DEBUG, 'unhideElement()');

    let target = element;

    for (let i = 0; i < levelsUp; i++) {
      if (target.parentNode) {
        target = target.parentNode;
      } else {
        break;
      }
    }

    modifyThenObserve(() => {
      target.classList.remove(SELECTORS.hiddenTitleClass);
    });
  }

  function unhideTitle({ id, slug }) {
    log(DEBUG, 'unhideTitle()');

    // Activity page reviews
    document.querySelectorAll(`section.activity-row [data-film-id="${id}"]`).forEach(posterElement => {
      unhideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      unhideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      unhideElement(posterElement, 1);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      unhideElement(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Popular with friends, competitions
    document.querySelectorAll(`div:not(.popmenu) [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      unhideElement(posterElement, 0);
    });
  }

  function updateLinkInPopMenu(titleIsHidden, link) {
    log(DEBUG, 'updateLinkInPopMenu()');

    link.setAttribute('data-title-hidden', titleIsHidden);

    const innerText = titleIsHidden ? 'Remove from filter' : 'Add to filter';
    link.innerText = innerText;
  }

  let OBSERVER = new MutationObserver(observeAndModify);

  let GMC = new GM_config({
    id: 'gmc-frame',
    events: {
      init: gmcInitialized,
    },
    fields: {
      hiddenTitles: {
        type: 'text',
        default: JSON.stringify([]),
      },
      hideStyle: {
        type: 'text',
        default: 'opacity: 0.05;',
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
