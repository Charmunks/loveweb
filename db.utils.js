require('dotenv').config()
const knex = require('knex')(require('./knexfile'))

async function addGame(gameName, authorIp, cdnLink) {
  const [game] = await knex('games')
    .insert({ game_name: gameName, author_ip: authorIp, cdn_link: cdnLink })
    .returning('*')
  return game
}

async function getGameByName(gameName) {
  return knex('games').where({ game_name: gameName }).first()
}

async function deleteGame(gameName) {
  return knex('games').where({ game_name: gameName }).del()
}

module.exports = { addGame, getGameByName, deleteGame }
