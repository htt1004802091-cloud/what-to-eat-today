"use strict";

const views = [...document.querySelectorAll("[data-view]")];
const entryButtons = [...document.querySelectorAll("[data-mode]")];
const backButtons = [...document.querySelectorAll('[data-action="back"]')];
const changeTakeoutButton = document.querySelector('[data-action="change-takeout"]');
const changeRecipeButton = document.querySelector('[data-action="change-recipe"]');
const openRecipeDetailButton = document.querySelector('[data-action="open-recipe-detail"]');
const backToRecipeButton = document.querySelector('[data-action="back-to-recipe"]');
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let takeoutItems = [];
let recipeItems = [];
let currentTakeoutName = null;
let currentRecipeName = null;
let currentRecipeItem = null;

function showView(viewName) {
  views.forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });

  if (viewName === "home") {
    document.title = "今天吃什么";
    document.querySelector("#page-title").focus({ preventScroll: true });
    return;
  }

  if (viewName === "recipe" || viewName === "recipe-detail") {
    window.scrollTo(0, 0);
  }

  const title = document.querySelector(`#${viewName}-view-title`);
  document.title = `${title.textContent}｜今天吃什么`;
  title.focus({ preventScroll: true });
}

function getRandomItem(items, currentName) {
  if (items.length === 0) {
    return null;
  }

  const choices = items.length > 1
    ? items.filter((item) => item.name !== currentName)
    : items;

  return choices[Math.floor(Math.random() * choices.length)];
}

function renderTakeout() {
  const item = getRandomItem(takeoutItems, currentTakeoutName);

  if (!item) {
    showError("takeout", "暂时没有可推荐的外卖，请检查数据文件。");
    return;
  }

  currentTakeoutName = item.name;
  document.querySelector("#takeout-name").textContent = item.name;
  document.querySelector("#takeout-category").textContent = item.category;
  const takeoutImage = document.querySelector("#takeout-image");
  takeoutImage.src = item.image;
  takeoutImage.alt = item.name;
  hideError("takeout");
}

function renderRecipe() {
  const item = getRandomItem(recipeItems, currentRecipeName);

  if (!item) {
    showError("recipe", "暂时没有可推荐的菜谱，请检查数据文件。");
    return;
  }

  currentRecipeName = item.name;
  currentRecipeItem = item;
  document.querySelector("#recipe-name").textContent = item.name;
  document.querySelector("#recipe-category").textContent = item.category;
  document.querySelector("#recipe-difficulty").textContent = item.difficulty;
  const recipeImage = document.querySelector("#recipe-image");
  recipeImage.src = item.image;
  recipeImage.alt = item.name;
  document.querySelector("#recipe-detail-view-title").textContent = item.name;
  document.querySelector("#recipe-detail-category").textContent = item.category;
  document.querySelector("#recipe-detail-difficulty").textContent = `难度：${item.difficulty}`;
  const recipeDetailImage = document.querySelector("#recipe-detail-image");
  recipeDetailImage.src = item.image;
  recipeDetailImage.alt = item.name;
  renderList("#recipe-ingredients", item.ingredients);
  renderList("#recipe-steps", item.steps);
  hideError("recipe");
}

function renderList(selector, items) {
  const list = document.querySelector(selector);
  list.replaceChildren();

  items.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });
}

function showError(mode, message) {
  const status = document.querySelector(`#${mode}-status`);
  status.textContent = message;
  status.hidden = false;
}

function hideError(mode) {
  const status = document.querySelector(`#${mode}-status`);
  status.hidden = true;
}

function animateResult(mode, render) {
  const result = document.querySelector(`[data-result="${mode}"]`);

  if (!result || reducedMotion.matches) {
    render();
    return;
  }

  if (result.classList.contains("is-leaving")) {
    return;
  }

  result.classList.remove("is-entering");
  result.classList.add("is-leaving");

  window.setTimeout(() => {
    render();
    result.classList.remove("is-leaving");
    result.classList.add("is-entering");

    window.setTimeout(() => {
      result.classList.remove("is-entering");
    }, 300);
  }, 140);
}

async function fetchJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`无法读取 ${path}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new TypeError(`${path} 的内容必须是数组`);
  }

  return data;
}

async function loadData() {
  try {
    [takeoutItems, recipeItems] = await Promise.all([
      fetchJson("data/takeout.json"),
      fetchJson("data/recipe.json"),
    ]);

    renderTakeout();
    renderRecipe();
  } catch (error) {
    console.error(error);
    showError("takeout", "数据读取失败，请通过本地服务器打开网站。");
    showError("recipe", "数据读取失败，请通过本地服务器打开网站。");
  }
}

entryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;

    if (mode === "takeout") {
      renderTakeout();
    } else {
      renderRecipe();
    }

    showView(mode);
  });
});

backButtons.forEach((button) => {
  button.addEventListener("click", () => showView("home"));
});

changeTakeoutButton.addEventListener("click", () => animateResult("takeout", renderTakeout));
changeRecipeButton.addEventListener("click", () => animateResult("recipe", renderRecipe));
openRecipeDetailButton.addEventListener("click", () => {
  if (currentRecipeItem) {
    showView("recipe-detail");
  }
});
backToRecipeButton.addEventListener("click", () => showView("recipe"));

loadData();
