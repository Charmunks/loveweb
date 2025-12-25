exports.up = function(knex) {
  return knex.schema.createTable('games', (table) => {
    table.increments('id').primary()
    table.string('game_name').notNullable()
    table.string('author_ip').notNullable()
    table.text('cdn_link').notNullable()
    table.timestamps(true, true)
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('games')
}
