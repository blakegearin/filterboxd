// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.7.0
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

      maybeAddListItemToSidebar();
      const outcome = addListItemToPopMenu();
      applyFilters();

      log(DEBUG, 'outcome', outcome);

      if (outcome === 'continue') continue;
      if (outcome === 'break') break;
    }
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

  const MAX_IDLE_MUTATIONS = 100;
  const MAX_HEADER_UPDATES = 100;
  const BEHAVIORS = [ 'Remove', 'Fade', 'Blur', 'Custom' ];

  let IDLE_MUTATION_COUNT = 0;
  let UPDATES_COUNT = 0;
  let SELECTORS = {
    filmPosterPopMenu: {
      self: '.film-poster-popmenu',
      userscriptListItemClass: 'filterboxd-list-item',
      addToList: '.film-poster-popmenu .menu-item-add-to-list',
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
    userpanel: {
      self: '#userpanel',
      userscriptListItemId: 'filterboxd-list-item',
      addThisFilm: '#userpanel .add-this-film',
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

      const addToListLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addToList);
      if (!addToListLink) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu.addToList} not found`);
        return 'break';
      }

      const addThisFilmLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addThisFilm);
      if (!addThisFilmLink) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu.addThisFilm} not found`);
        return 'break';
      }

      modifyThenObserve(() => {
        let userscriptListItem = lastListItem.cloneNode(true);
        userscriptListItem.classList.add(SELECTORS.filmPosterPopMenu.userscriptListItemClass);

        userscriptListItem = buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink);

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

    // Diary
    document.querySelectorAll(`.td-film-details [data-film-id="${id}"]:not(.${SELECTORS.processedClass.hide})`).forEach(posterElement => {
      addFilterTitleClass(posterElement, 2);
      posterElement.classList.add(SELECTORS.processedClass.hide);
    });

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

  function buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink) {
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

    const titleId = parseInt(addToListLink.getAttribute('data-film-id'));
    userscriptLink.setAttribute('data-film-id', titleId);

    const filmAction = addToListLink.getAttribute('data-new-list-with-film-action');
    log(VERBOSE, 'filmAction', filmAction);

    const titleSlug = filmAction.split('/').at(-2);
    userscriptLink.setAttribute('data-film-slug', titleSlug);

    const titleName = addThisFilmLink.getAttribute('data-film-name');
    userscriptLink.setAttribute('data-film-name', titleName);
    const titleYear = addThisFilmLink.getAttribute('data-film-release-year');
    userscriptLink.setAttribute('data-film-release-year', titleYear);

    const titleIsHidden = getFilteredTitles().some(hiddenTitle => hiddenTitle.id === titleId);
    updateLinkInPopMenu(titleIsHidden, userscriptLink);

    userscriptLink.removeAttribute('class');

    return userscriptListItem;
  }

  function createFormRow({
    formRowClass = [],
    formRowStyle = '',
    labelText = '',
    inputValue = '',
    inputType = 'text',
    inputStyle = '',
    selectArray = [],
    selectOnChange = () => {},
    notes = '',
    notesStyle = '',
  }) {
    const formRow = document.createElement('div');
    formRow.classList.add('form-row');
    formRow.style.cssText = formRowStyle;
    formRow.classList.add(...formRowClass);

    const selectList = document.createElement('div');
    selectList.classList.add('select-list');

    const label = document.createElement('label');
    label.classList.add('label');
    label.textContent = labelText;
    selectList.appendChild(label);

    const inputDiv = document.createElement('div');
    inputDiv.classList.add('input');
    inputDiv.style.cssText = inputStyle;

    if (inputType === 'select') {
      const select = document.createElement('select');
      select.classList.add('select');

      selectArray.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;

        if (option === inputValue) optionElement.setAttribute('selected', 'selected');

        select.appendChild(optionElement);
      });

      select.onchange = selectOnChange;

      inputDiv.appendChild(select);
    } else if (inputType === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.classList.add('field');
      input.value = inputValue;

      inputDiv.appendChild(input);
    }

    selectList.appendChild(inputDiv);

    if (notes) {
      const notesElement = document.createElement('p');
      notesElement.classList.add('notes');
      notesElement.style.cssText = notesStyle;
      notesElement.textContent = notes;

      selectList.appendChild(notesElement);
    }

    formRow.appendChild(selectList);

    return formRow;
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

    const behaviorFadeAmount = GMC.get('behaviorFadeAmount');
    log(VERBOSE, 'behaviorFadeAmount', behaviorFadeAmount);

    const behaviorBlurAmount = GMC.get('behaviorBlurAmount');
    log(VERBOSE, 'behaviorBlurAmount', behaviorBlurAmount);

    const behaviorCustomValue = GMC.get('behaviorCustomValue');
    log(VERBOSE, 'behaviorCustomValue', behaviorCustomValue);

    switch (behaviorType) {
      case 'Remove':
        behaviorStyle = 'display: none !important;';
        break;
      case 'Fade':
        behaviorStyle = `opacity: ${behaviorFadeAmount}%`;
        break;
      case 'Blur':
        behaviorStyle = `filter: blur(${behaviorBlurAmount}px)`;
        break;
      case 'Custom':
        behaviorStyle = behaviorCustomValue;
        break;
    }

    updateBehaviorCSSVariables(behaviorType);

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
        visibility: hidden;
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

    let formColumnsDiv = document.createElement('div');
    formColumnsDiv.classList.add('form-columns', '-cols2');

    // Behavior
    const behaviorValue = GMC.get('behaviorType');
    log(DEBUG, 'behaviorValue', behaviorValue);

    const behaviorChange = (event) => {
      const behaviorType = event.target.value;
      updateBehaviorCSSVariables(behaviorType);
    };

    const behaviorFormRow = createFormRow({
      formRowStyle: 'width: 29%;',
      labelText: 'Behavior',
      inputValue: behaviorValue,
      inputType: 'select',
      selectArray: BEHAVIORS,
      selectOnChange: behaviorChange,
    });

    formColumnsDiv.appendChild(behaviorFormRow);

    // Fade amount
    const behaviorFadeAmount = parseInt(GMC.get('behaviorFadeAmount'));
    log(DEBUG, 'behaviorFadeAmount', behaviorFadeAmount);

    const fadeAmountFormRow = createFormRow({
      formRowClass: ['update-details'],
      formRowStyle: 'width: 68.8%; float: right; display: var(--filterboxd-behavior-fade);',
      labelText: 'Amount',
      inputValue: behaviorFadeAmount,
      inputType: 'select',
      inputStyle: 'width: 100px !important;',
      selectArray: [ 0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90],
      notes: '%',
      notesStyle: 'width: 10px; margin-left: 14px;',
    });

    formColumnsDiv.appendChild(fadeAmountFormRow);

    // Blur amount
    const behaviorBlurAmount = parseInt(GMC.get('behaviorBlurAmount'));
    log(DEBUG, 'behaviorBlurAmount', behaviorBlurAmount);

    const blurAmountFormRow = createFormRow({
      formRowClass: ['update-details'],
      formRowStyle: 'width: 68.8%; float: right; display: var(--filterboxd-behavior-blur);',
      labelText: 'Amount',
      inputValue: behaviorBlurAmount,
      inputType: 'select',
      inputStyle: 'width: 100px !important;',
      selectArray: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 1000 ],
      notes: 'px',
      notesStyle: 'width: 10px; margin-left: 14px;',
    });

    formColumnsDiv.appendChild(blurAmountFormRow);

    // Custom CSS
    const behaviorCustomValue = GMC.get('behaviorCustomValue');
    log(DEBUG, 'behaviorCustomValue', behaviorCustomValue);

    const cssFormRow = createFormRow({
      formRowStyle: 'width: 68.8%; float: right; display: var(--filterboxd-behavior-custom);',
      labelText: 'CSS',
      inputValue: behaviorCustomValue,
      inputType: 'text',
    });

    formColumnsDiv.appendChild(cssFormRow);

    userscriptConfigurationDiv.appendChild(formColumnsDiv);

    const clearDiv = userscriptConfigurationDiv.querySelector(SELECTORS.settings.clear);
    clearDiv.remove();

    let saveDiv = document.createElement('div');
    saveDiv.style.cssText = 'display: flex; align-items: center;';

    let saveInput = document.createElement('input');
    saveInput.classList.add('button', 'button-action');
    saveInput.setAttribute('value', 'Save');
    saveInput.setAttribute('type', 'submit');
    saveInput.onclick = (event) => {
      event.preventDefault();

      const behaviorType = behaviorFormRow.querySelector('select').value;
      log(DEBUG, 'behaviorType', behaviorType);

      GMC.set('behaviorType', behaviorType);
      GMC.save();

      updateBehaviorCSSVariables(behaviorType);

      if (behaviorType === 'Fade') {
        const behaviorFadeAmount = fadeAmountFormRow.querySelector('select').value;
        log(DEBUG, 'behaviorFadeAmount', behaviorFadeAmount);

        GMC.set('behaviorFadeAmount', behaviorFadeAmount);
        GMC.save();
      } else if (behaviorType === 'Blur') {
        const behaviorBlurAmount = blurAmountFormRow.querySelector('select').value;
        log(DEBUG, 'behaviorBlurAmount', behaviorBlurAmount);

        GMC.set('behaviorBlurAmount', behaviorBlurAmount);
        GMC.save();
      }
      else if (behaviorType === 'Custom') {
        const behaviorCustomValue = cssFormRow.querySelector('input').value;
        log(DEBUG, 'behaviorCustomValue', behaviorCustomValue);

        GMC.set('behaviorCustomValue', behaviorCustomValue);
        GMC.save();
      }

      displaySavedBadge();
    };

    saveDiv.appendChild(saveInput);

    let checkContainerDiv = document.createElement('div');
    checkContainerDiv.classList.add('check-container');
    checkContainerDiv.style.cssText = 'margin-left: 10px;';

    let usernameAvailableParagraph = document.createElement('p');
    usernameAvailableParagraph.classList.add(
      'username-available',
      'has-icon',
      'hidden',
      SELECTORS.settings.savedBadgeClass,
    );
    usernameAvailableParagraph.style.cssText = 'float: left;';

    let iconSpan = document.createElement('span');
    iconSpan.classList.add('icon');

    const savedText = document.createTextNode('Saved');

    usernameAvailableParagraph.appendChild(iconSpan);
    usernameAvailableParagraph.appendChild(savedText);

    checkContainerDiv.appendChild(usernameAvailableParagraph);
    saveDiv.appendChild(checkContainerDiv);

    userscriptConfigurationDiv.appendChild(saveDiv);

    favoriteFilmsDiv.parentNode.insertBefore(userscriptConfigurationDiv, favoriteFilmsDiv.nextSibling);
  }

  function maybeAddListItemToSidebar() {
    log(DEBUG, 'maybeAddListItemToSidebar()');

    if (document.querySelector(createId(SELECTORS.userpanel.userscriptListItemId))) return;

    const userpanel = document.querySelector(SELECTORS.userpanel.self);

    if (!userpanel) {
      log(INFO, 'Userpanel not found');
      return;
    }

    const secondLastListItem = userpanel.querySelector('li:nth-last-child(2)');
    if (!secondLastListItem ) {
      log(INFO, 'Second last list item not found');
      return;
    }

    let userscriptListItem = secondLastListItem.cloneNode(true);
    userscriptListItem.setAttribute('id', SELECTORS.userpanel.userscriptListItemId);

    const addToListLink = secondLastListItem.firstElementChild;
    const addThisFilmLink = userpanel.querySelector(SELECTORS.userpanel.addThisFilm);

    userscriptListItem = buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink);

    secondLastListItem.parentNode.insertBefore(userscriptListItem, userpanel.querySelector('li:nth-last-of-type(1)'));
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

  function updateBehaviorCSSVariables(behaviorType) {
    log(DEBUG, 'updateBehaviorTypeVariable()');

    const fadeValue = behaviorType === 'Fade' ? 'block' : 'none';
    document.documentElement.style.setProperty('--filterboxd-behavior-fade', fadeValue);

    const blurValue = behaviorType === 'Blur' ? 'block' : 'none';
    document.documentElement.style.setProperty('--filterboxd-behavior-blur', blurValue);

    const customValue = behaviorType === 'Custom' ? 'block' : 'none';
    document.documentElement.style.setProperty('--filterboxd-behavior-custom', customValue);
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
        options: BEHAVIORS,
        default: 'Fade',
      },
      behaviorBlurAmount: {
        type: 'int',
        default: 3,
      },
      behaviorCustomValue: {
        type: 'text',
        default: '',
      },
      behaviorFadeAmount: {
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
