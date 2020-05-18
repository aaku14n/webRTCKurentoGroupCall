/**
 *
 */
export default class Register {
  /**
   *
   */
  constructor() {
    this.usersByName = {};
    this.userSessionIds = {};
  }

  /**
   * register
   *
   * @param {object} user
   */
  register(user) {
    this.usersByName[user.userId] = user;
    this.userSessionIds[user.id] = user;
  }

  /**
   *
   * @param {string} name
   */
  unregister(name) {
    let user = this.getByName(name);
    if (user) {
      delete this.usersByName[user.userId];
      delete this.userSessionIds[user.id];
    }
  }

  /**
   *
   * @param {*} name
   */
  removeByName(name) {
    let user = this.getByName(name);
    if (user) {
      delete this.usersByName[user.userId];
      delete this.userSessionIds[user.id];
    }
  }

  /**
   *
   * @param {string} name
   */
  getByName(name) {
    console.log("====================");
    console.log(this.usersByName);
    return this.usersByName[name];
  }

  /**
   *
   * @param {*} id
   */
  getById(id) {
    return this.userSessionIds[id];
  }
}
