import url from 'url';
import traverson from 'traverson';
import pluralize from 'pluralize';
import hal_adapter from 'traverson-hal';
import debug_logger from 'debug';

let debug = debug_logger('rest-client-builder');

traverson.registerMediaType(hal_adapter.mediaType, hal_adapter);

function json(res) {
    try {
        return res && res.body ? JSON.parse(res.body) : {};
    }
    catch(e) {
        return {};
    }
}

function add_child_accessors(client, parent, children) {
    if (!children) 
        return;
    children.forEach(x => {
        parent[x.name] = () => {
            let proxy = new resource_proxy(client, x.name, parent, x._actions);
            add_child_accessors(client, proxy, x._children);
            return proxy;
        };
        parent[pluralize.singular(x.name)] = id => {
            if (!id)
                throw new Error("The 'id' parameter is required.");
            let proxy = new resource_proxy(client, x.name, parent, x._actions, id);
            add_child_accessors(client, proxy, x._children);
            return proxy;
        };
    });
}

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
                    'Accept': 'application/hal+json',
                    'Content-Type': 'application/json'
                }
            });
         return this;
    }

    get uri() {
        return this._uri;
    }

    get api() {
        return this._api;
    }

    root() {
        return new Promise((resolve, reject) => {
            this.api
                .newRequest()
                .get((error, response) => error ? reject(error) : resolve({ response, resource: json(response) })); 
        });
    }

    resource_at(href, params) {
        return new Promise((resolve, reject) => {
            this.api
                .newRequest()
                .from(url.resolve(this.api.getFrom(), href))
                .withTemplateParameters(params)
                .get((error, response) => error ? reject(error) : resolve({ response, resource: json(response) })); 
        });
    }
}

class resource_proxy {
    constructor(client, name, parent, actions, parent_id) {
        this._name = name;
        this._children = [];
        this._actions = actions || {
            find: true,
            create: true,
            update: true,
            patch: true,
            delete: true,
            find_by_id: true,
            delete_by_id: true,
            find_by_named_query: true
        };
        this._client = client;
        this._parent = parent || null;
        this._parent_id = parent_id || null;
        this._singular_name = pluralize.singular(name);
        this._id_name = `${this._singular_name}_id`;
    }

    get name() {
        return this._name;
    }

    get client() {
        return this._client;
    }

    get parent() {
        return this._parent;
    }

    get parent_id() {
        return this._parent_id;
    }

    get singular_name() {
        return this._singular_name;
    }

    _throw_if_disabled(action) {
        if (!this._actions[action])
            throw new Error(`This resource does not permit '${action}'.`);
    }

    find(params, options) {
        this._throw_if_disabled('find');
        for (let x in params) {
            if (Array.isArray(params[x]))
                params[x] = params[x].join(',');
        }
        let opts = Object.assign({}, { qs: params || {} }, options);
        return new Promise((resolve, reject) => {
            this.client
                .api
                .newRequest()
                .withRequestOptions(opts)
                .follow(this.name)
                .get((error, response) => error ? reject(error) : resolve({ response, resource: json(response) })); 
        });
    }

    create(data, options) {
        this._throw_if_disabled('create');
        if (!data)
            throw new Error("The 'data' parameter is required.");
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .post(data, (error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    find_by_id(id, options) {
        this._throw_if_disabled('find_by_id');
        if (!id)
            throw new Error("The 'id' parameter is required.");
        let params = {};
        params[this._id_name] = id;
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .withTemplateParameters(params)
                .get((error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    patch(id, data, options) {
        this._throw_if_disabled('patch');
        if (!id)
            throw new Error("The 'id' parameter is required.");
        if (!data)
            throw new Error("The 'data' parameter is required.");
        let params = {};
        params[this._id_name] = id;
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .withTemplateParameters(params)
                .patch(data, (error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    delete(filters, options) {
        this._throw_if_disabled('delete');
        let params = {};
        let opts = Object.assign({}, { qs: filters || {} }, options);
        return new Promise((resolve, reject) => {
            this.client
                .api
                .newRequest()
                .withRequestOptions(opts)
                .follow(this.name)
                .withTemplateParameters(params)
                .del((error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    delete_by_id(id, options) {
        this._throw_if_disabled('delete_by_id');
        if (!id)
            throw new Error("The 'id' parameter is required.");
        let params = {};
        params[this._id_name] = id;
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .withTemplateParameters(params)
                .del((error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    update(id, data, options) {
        this._throw_if_disabled('update');
        if (!id)
            throw new Error("The 'id' parameter is required.");
        if (!data)
            throw new Error("The 'data' parameter is required.");
        let params = {};
        params[this._id_name] = id;
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .withTemplateParameters(params)
                .put(data, (error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
    }

    find_by_named_query(name, options) {
        this._throw_if_disabled('find_by_named_query');
        if (!name)
            throw new Error("The 'name' parameter is required.");
        let params = {};
        params[this._id_name] = name;
        return new Promise((resolve, reject) => {
            let request = this.client.api.newRequest();
            if (options)
                request = request.withRequestOptions(options);
            request
                .follow(this.name)
                .withTemplateParameters(params)
                .get((error, response) => error ? reject(error) : resolve({ response, resource: json(response) }));
        });
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
            delete_by_id: true,
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

    disable_delete_by_id() {
        this._actions.delete_by_id = false;
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
        add_child_accessors(client, client, this._children);
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
