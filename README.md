# Fluent REST

A flexible fluent library that automatically creates Express compatible RESTful endpoints for any sql-bricks compatible
database connection.

  [![Build: master](https://travis-ci.org/jeffpanici75/fluent-rest.svg?branch=master)](https://travis-ci.org/jeffpanici75/fluent-rest)

## Features

  * Fully RESTful endpoints without any weird query string madness or RPC masquerading as REST
  * Select the fields returned for entities using the *fields* query string parameter
  * Control the sort order of entities returned from collections via the *sort* query string parameter
  * Support full-text searches via the *q* query string parameter and a custom entity configurable via *use_full_text_entity*
  * Accept header/extensions can be easily honored in output formatters
  * Chainable output formatters, similar to Express middlewares, allow you to fully customize what is sent back to the client

## Installation

```bash
$ npm install fluent-rest
```

## Usage

```js
// Standard Express app set up code would be here

import { rest_service_builder, hal_formatter } from 'fluent-rest/rest_service_builder';
let db = require('pg-bricks').configure('YOUR CONNECTION STRING');

let customers = builder
  .mount_at(app, '/api/v1')
  .resource('customers')
  .description('This is a collection of customers.')
  .for_entity(db, 'customer')
  .endpoint();

```
