let url = require('url');
let promise = require('bluebird');
let traverson = require('traverson'); 
let pluralize = require('pluralize');
let hal_adapter = require('traverson-hal');
let debug = require('debug')('rest-client-builder');

traverson.registerMediaType(hal_adapter.mediaType, hal_adapter);

let builder = new rest_client_builder();

let root = builder.root();
let accounts = root.resource('accounts');
accounts.resource('properties');
accounts.resource('addresses');
accounts.resource('phones');

let api = root.hal();

class hal_client {
    constructor() {
        this._uri = null;
        this._api = null;
    }

    from(uri) {
        this._uri = uri;
        this._api = traverson
            .from(uri)
            .jsonHal()
            .withRequestOptions({
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
         return this;
    }

    root() {
        return new Promise((resolve, reject) => {
            this._api
                .newRequest()
                .getResource((error, resource) => error ? reject(error) : resolve(resource)); 
        });
    }
}

class resource_proxy {
    constructor(api, name, parent) {
        this._api = api;
        this._name = name;
        this._children = [];
        this._parent = parent || null;
    }

    find(params) {
    }

    create(data) {
    }

    find_by_id(id) {
    }

    patch(id, data) {
    }

    delete(filters) {
    }

    delete_by_id(id) {
    }

    update(id, data) {
    }

    find_by_named_query(name) {
    }
}

class resource_builder {
    constructor(name, parent) {
        this._name = name;
        this._actions = {
            find: true,
            create: true,
            update: true,
            patch: true,
            delete: true,
            find_by_id: true,
            find_by_named_query: true
        };
        this._children = [];
        this._description = null;
        this._parent = parent || null;
    }

    get name() {
        return this._name;
    }

    get parent() {
        return this._parent;
    }

    resource(name) {
        let b = new resource_builder(name, this);
        this._children.push(b);
        return b;
    }

    description(desc) {
        this._description = desc;
        return this;
    }

    disable_find() {
        this._actions.find = false;
        return this;
    }

    disable_create() {
        this._actions.create = false;
        return this;
    }

    disable_update() {
        this._actions.update = false;
        return this;
    }

    disable_patch() {
        this._actions.patch = false;
        return this;
    }

    disable_delete() {
        this._actions.delete = false;
        return this;
    }

    disable_find_by_id() {
        this._actions.find_by_id = false;
        return this;
    }

    disable_find_by_named_query() {
        this._actions.find_by_named_query = false;
        return this;
    }
}

class root_resource_builder {
    constructor() {
        this._children = [];
    }

    hal() {
        let client = new hal_client();

        for (let x in this._children)
            client[x.name] = new resource_proxy(x.name);

        return client;
    }

    resource(name) {
        let b = new resource_builder(name, this);
        this._children.push(b);
        return b;
    }
}


export class rest_client_builder {
    constructor() {
    }

    root() {
        return new root_resource_builder();
    }
}
