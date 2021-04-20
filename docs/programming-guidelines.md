Naming Conventions
==================
* *Channel* names must be plural. However, if the pluralization results in hard-to-read name, a singular name can be used. For example: status is preferable over statuses. Pluralization of the channel is recommended because it houses several items.
```js
channels: {
  responses: {},
  items: {},
  containers: {},
  status: {}
}
```
* *Unit* names must by singular.
* A *Custom* unit or network, preferably, be named to identify its function. Appending *Unit* or *Network* to the class name should be avoided.
```js
// Prefer Dropbox over DropboxUnit
class Dropbox extends Unit {
}

// Prefer Dropbox over DropboxNetwork
class Dropbox extends Network {
}
```

Code Structure
==============
An application has several units and networks. The network framework is designed with the assumption that a network or unit may communicate with any othe network or unit in the application. With that design approach, it is recommended to have a single directory called networks to house them all.

It is recommended to keep the functional code to separate directory called functions. Networks and Units must strictly be used to connect communication channels and call relevant functions.

```
+-- package.json
+-- src
|   +-- networks
|   |   +-- main.js
|   |   +-- dropbox.js
|   |   +-- cloudservice.js
|   +-- functions
|   |   +-- dropbox.js
|   |   +-- cloudservice.js
```
