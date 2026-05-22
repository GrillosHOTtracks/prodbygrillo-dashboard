// Thin compatibility shim — all logic lives in accountManager.js
const accountManager = require('./accountManager')

function getAuthClient()       { return accountManager.getAuthClient() }
function isAuthenticated()     { return accountManager.isAuthenticated() }
function getAuthUrl()          { return accountManager.getAuthUrl() }
async function exchangeCode(c) { return accountManager.exchangeCode(c) }

module.exports = { getAuthClient, isAuthenticated, getAuthUrl, exchangeCode }
