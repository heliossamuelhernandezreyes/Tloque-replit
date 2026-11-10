import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"

test("0029 preserves legacy cards and binds only proven narrative source revisions",async()=>{
  const pg=new PGlite()
  try{
    await pg.exec(`
      create table licensed_editions(id integer primary key,book_id integer);
      create table book_cards(id integer primary key,book_id integer);
      create table user_cards(id integer primary key,card_id integer);
      create table narrative_projects(book_id integer,chapter_index integer,revision integer,content_hash text);
      create table experience_profiles(id integer primary key,book_id integer,chapter_index integer,source_project_revision integer);
      insert into licensed_editions values(11,1),(22,2);
      insert into book_cards values(1,1),(2,2);
      insert into user_cards values(1,1),(2,2);
      insert into narrative_projects values(1,0,3,repeat('a',64)),(2,0,4,repeat('b',64));
      insert into experience_profiles values(1,1,0,3),(2,2,0,2);
    `)
    const migration=await readFile("migrations/0029_audit_integrity.sql","utf8")
    await pg.exec(migration);await pg.exec(migration)
    assert.deepEqual((await pg.query("select edition_id from user_cards order by id")).rows,[{edition_id:null},{edition_id:null}])
    assert.deepEqual((await pg.query("select content_hash from experience_profiles order by id")).rows,[{content_hash:"a".repeat(64)},{content_hash:null}])
    await pg.exec("insert into user_cards(id,card_id,edition_id) values(3,1,11)")
    await assert.rejects(pg.exec("update user_cards set edition_id=null where id=3"),/immutable/)
    await assert.rejects(pg.exec("insert into user_cards(id,card_id,edition_id) values(4,2,11)"),/another work/)
    await assert.rejects(pg.exec("update experience_profiles set content_hash='unproven' where id=2"),/experience_profiles_hash_check/)
  }finally{await pg.close()}
})
