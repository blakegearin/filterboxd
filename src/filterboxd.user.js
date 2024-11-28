// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.3.0
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

  const MAX_IDLE_MUTATIONS = 100;
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
    filterTitleClass: 'filter-title',
    processedClass: {
      hide: 'hide-processed',
      unhide: 'unhide-processed',
    },
    settings: {
      clear: '.clear',
      favoriteFilms: '.favourite-films-selector',
      filteredTitleLinkClass: 'filtered-title-span',
      note: '.note',
      posterList: '.poster-list',
      savedBadgeClass: 'filtered-saved',
      subtitle: '.mob-subtitle',
    },
  };

  function addFilterTitleClass(element, levelsUp = 0) {
    log(DEBUG, 'addFilterTitleClass()');

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
      target.classList.add(SELECTORS.filterTitleClass);
    });
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
            removeTitle(titleMetadata);
            removeFromFilterTitles(titleMetadata);
          } else {
            addTitle(titleMetadata);
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

        const titleIsHidden = getFilteredTitles().some(hiddenTitle => hiddenTitle.id === titleId);
        updateLinkInPopMenu(titleIsHidden, userscriptLink);

        userscriptLink.removeAttribute('class');

        lastListItem.parentNode.append(userscriptListItem);
      });
    });

    return;
  }

  function addTitle({ id, slug }) {
    log(DEBUG, 'addTitle()');

    // Activity page reviews
    document.querySelectorAll(`section.activity-row [data-film-id="${id}"]`).forEach(posterElement => {
      addFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      addFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      addFilterTitleClass(posterElement, 1);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      addFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

    // TODO: Diary

    // Popular with friends, competitions
    const remainingElements = document.querySelectorAll(
      `div:not(.popmenu):not(.actions-panel) [data-film-id="${id}"]:not(aside [data-film-id="${id}"]):not(.${SELECTORS.processedClass.hide})`,
    );
    remainingElements.forEach(posterElement => {
      addFilterTitleClass(posterElement, 0);
    });
  }

  function addToHiddenTitles(titleMetadata) {
    log(DEBUG, 'addToHiddenTitles()');

    const filteredTitles = getFilteredTitles();
    filteredTitles.push(titleMetadata);
    log(VERBOSE, 'filteredTitles', filteredTitles);

    GMC.set('filteredTitles', JSON.stringify(filteredTitles));
    GMC.save();
  }

  function applyFilters() {
    log(DEBUG, 'applyFilters()');

    const filteredTitles = getFilteredTitles();
    log(VERBOSE, 'filteredTitles', filteredTitles);

    filteredTitles.forEach(titleMetadata => addTitle(titleMetadata));
  }

  function displaySavedBadge() {
    const savedBadge = document.querySelector(`.${SELECTORS.settings.savedBadgeClass}`);

    savedBadge.classList.remove('hidden');
    savedBadge.classList.add('fade');

    setTimeout(() => {
      savedBadge.classList.add('fade-out');
    }, 2000);

    setTimeout(() => {
      savedBadge.classList.remove('fade', 'fade-out');
      savedBadge.classList.add('hidden');
    }, 3000);
  }

  function getFilteredTitles() {
    return JSON.parse(GMC.get('filteredTitles'));
  }

  function gmcInitialized() {
    log(DEBUG, 'gmcInitialized()');

    updateLogLevel();

    log(QUIET, 'Running');

    GMC.css.basic = '';

    if (RESET) {
      log(QUIET, 'Resetting GMC');
      GMC.set('filteredTitles', JSON.stringify([]));
      GMC.reset();
      GMC.save();
    }

    let userscriptStyle = document.createElement('style');
    userscriptStyle.setAttribute('id', 'filterboxd-style');

    let behaviorStyle;
    let behaviorType = GMC.get('behaviorType');

    const behaviorFadeValue = GMC.get('behaviorFadeValue');
    log(VERBOSE, 'behaviorFadeValue', behaviorFadeValue);

    switch (behaviorType) {
      case 'Remove':
        behaviorStyle = 'display: none !important;';
        break;
      case 'Fade':
        behaviorStyle = `opacity: ${behaviorFadeValue}%`;
        break;
      case 'Custom':
        behaviorStyle = '';
        break;
    }

    log(VERBOSE, 'behaviorStyle', behaviorStyle);

    userscriptStyle.textContent += `
      .${SELECTORS.filterTitleClass}
      {
        ${behaviorStyle}
      }

      .${SELECTORS.settings.filteredTitleLinkClass}
      {
        cursor: pointer;
        margin-right: 0.3rem !important;
      }

      .${SELECTORS.settings.filteredTitleLinkClass}:hover
      {
        background: #303840;
        color: #def;
      }

      .hidden {
        display: none;
      }

      .fade {
        opacity: 1;
        transition: opacity 1s ease-out;
      }

      .fade.fade-out {
        opacity: 0;
      }
    `;
    document.body.appendChild(userscriptStyle);

    applyFilters();
    maybeAddConfigurationToSettings();

    startObserving();
  }

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
    userscriptConfigurationDiv.querySelector(SELECTORS.settings.note).innerText = 'Click to open or right click to remove.';

    const hiddenTitlesParagraph = document.createElement('p');
    let hiddenTitlesDiv = document.createElement('div');
    hiddenTitlesDiv.classList.add('text-sluglist');

    const filteredTitles = getFilteredTitles();
    log(VERBOSE, 'filteredTitles', filteredTitles);

    filteredTitles.forEach(hiddenTitle => {
      log(VERBOSE, 'hiddenTitle', hiddenTitle);

      let filteredTitleLink = document.createElement('a');
      filteredTitleLink.href= `/film/${hiddenTitle.slug}`;

      filteredTitleLink.classList.add(
        'text-slug',
        SELECTORS.processedClass.hide,
        SELECTORS.settings.filteredTitleLinkClass,
      );
      filteredTitleLink.setAttribute('data-film-id', hiddenTitle.id);
      filteredTitleLink.innerText = `${hiddenTitle.name} (${hiddenTitle.year})`;

      filteredTitleLink.oncontextmenu = (event) => {
        event.preventDefault();

        removeTitle(hiddenTitle);
        removeFromFilterTitles(hiddenTitle);
        filteredTitleLink.remove();
      };

      hiddenTitlesParagraph.appendChild(filteredTitleLink);
    });

    hiddenTitlesDiv.appendChild(hiddenTitlesParagraph);
    userscriptConfigurationDiv.append(hiddenTitlesDiv);

    let behaviorDiv = document.createElement('div');
    behaviorDiv.classList.add('form-row');

    let checkContainerDiv = document.createElement('div');
    checkContainerDiv.classList.add('check-container');

    let usernameAvailableParagraph = document.createElement('p');
    usernameAvailableParagraph.classList.add(
      'username-available',
      'has-icon',
      'hidden',
      SELECTORS.settings.savedBadgeClass,
    );

    let iconSpan = document.createElement('span');
    iconSpan.classList.add('icon');

    const savedText = document.createTextNode('Saved');

    usernameAvailableParagraph.appendChild(iconSpan);
    usernameAvailableParagraph.appendChild(savedText);

    checkContainerDiv.appendChild(usernameAvailableParagraph);

    let selectListDiv = document.createElement('div');
    selectListDiv.classList.add('select-list');

    let behaviorLabel = document.createElement('label');
    behaviorLabel.classList.add('label');
    behaviorLabel.innerText = 'Behavior';

    let behaviorInputDiv = document.createElement('div');
    behaviorInputDiv.classList.add('input');

    let behaviorSelect = document.createElement('select');
    behaviorSelect.classList.add('select');
    behaviorSelect.onchange = (event) => {
      console.log('event');
      console.dir(event, { depth: null });

      console.log('event.target');
      console.dir(event.target, { depth: null });

      console.log('event.target.value');
      console.dir(event.target.value, { depth: null });

      GMC.set('behaviorType', event.target.value);
      GMC.save();

      displaySavedBadge();
    };

    const behaviorValue = GMC.get('behaviorType');
    log(SILENT, 'behaviorValue', behaviorValue);

    const behaviorOptions = [
      'Remove',
      'Fade',
      'Custom',
    ];

    behaviorOptions.forEach(optionName => {
      let option = document.createElement('option');
      option.setAttribute('value', optionName);
      option.innerText = optionName;

      if (optionName === behaviorValue) option.setAttribute('selected', 'selected');

      behaviorSelect.appendChild(option);
    });

    behaviorInputDiv.appendChild(behaviorSelect);
    selectListDiv.appendChild(behaviorLabel);
    selectListDiv.appendChild(behaviorInputDiv);
    behaviorDiv.appendChild(checkContainerDiv);
    behaviorDiv.appendChild(selectListDiv);
    userscriptConfigurationDiv.appendChild(behaviorDiv);

    const clearDiv = userscriptConfigurationDiv.querySelector(SELECTORS.settings.clear);
    clearDiv.remove();

    favoriteFilmsDiv.parentNode.insertBefore(userscriptConfigurationDiv, favoriteFilmsDiv.nextSibling);
  }

  function removeFilterTitleClass(element, levelsUp = 0) {
    log(DEBUG, 'removeFilterTitleClass()');

    let target = element;

    for (let i = 0; i < levelsUp; i++) {
      if (target.parentNode) {
        target = target.parentNode;
      } else {
        break;
      }
    }

    modifyThenObserve(() => {
      target.classList.remove(SELECTORS.filterTitleClass);
    });
  }

  function removeFromFilterTitles(titleMetadata) {
    let filteredTitles = getFilteredTitles();
    filteredTitles = filteredTitles.filter(hiddenTitle => hiddenTitle.id !== titleMetadata.id);

    GMC.set('filteredTitles', JSON.stringify(filteredTitles));
    GMC.save();
  }

  function removeTitle({ id, slug }) {
    log(DEBUG, 'removeTitle()');

    // Activity page reviews
    document.querySelectorAll(`section.activity-row [data-film-id="${id}"]`).forEach(posterElement => {
      removeFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      removeFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // New from friends
    document.querySelectorAll(`.poster-container [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      removeFilterTitleClass(posterElement, 1);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Reviews
    document.querySelectorAll(`.review-tile [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      removeFilterTitleClass(posterElement, 3);
      posterElement.classList.add(SELECTORS.processedClass.unhide);
    });

    // Popular with friends, competitions
    document.querySelectorAll(`div:not(.popmenu) [data-film-id="${id}"]:not(.${SELECTORS.processedClass.unhide})`).forEach(posterElement => {
      removeFilterTitleClass(posterElement, 0);
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
      behaviorType: {
        type: 'select',
        options: [
          'Remove',
          'Fade',
          'Custom',
        ],
        default: 'Fade',
      },
      behaviorFadeValue: {
        type: 'int',
        default: 10,
      },
      filteredTitles: {
        type: 'text',
        default: JSON.stringify([]),
      },
      logLevel: {
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
