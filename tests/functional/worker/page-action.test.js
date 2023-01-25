const testDriver = require('../../../tools/jil/index')
const { workerTypes, typeToMatcher } = require('./helpers')
const { validatePageActionData, fail } = require('../ins/ins-internal-help.cjs')	// shared helpers

workerTypes.forEach(type => {  // runs all test for classic & module workers & use the 'workers' browser-matcher for classic and the 'workersFull' for module
	const browsersWithOrWithoutModuleSupport = typeToMatcher(type);
	paSubmission(type, browsersWithOrWithoutModuleSupport);
	paRetry(type, browsersWithOrWithoutModuleSupport);
	paPrecedence(type, browsersWithOrWithoutModuleSupport);
});

// --- Tests ---
function paSubmission (type, supportRegOrESMWorker) {
	testDriver.test(`${type} - addPageAction sends PA event`, supportRegOrESMWorker, function (t, browser, router) {
		let assetURL = router.assetURL(`worker/${type}-worker.html`, {
			init: {
				page_action: { harvestTimeSeconds: 5 }
			},
      workerCommands: [`newrelic.addPageAction("DummyEvent", { free: "tacos" })`]
    });

		let loadPromise = browser.get(assetURL);
		let insPromise = router.expectIns();

		Promise.all([loadPromise, insPromise])
		.then(( [/* loadPromise junk */, {req, query, body}] ) => {
      t.equal(req.method, 'POST', 'first PageAction submission is a POST')
      t.notOk(query.ins, 'query string does not include ins parameter')
      validatePageActionData(t, JSON.parse(body).ins, query)
      t.end()
    }).catch(fail(t));
	});
}

function paRetry (type, supportRegOrESMWorker) {
	testDriver.test(`${type} - PageActions are retried when collector returns 429`, supportRegOrESMWorker, function (t, browser, router) {
		let assetURL = router.assetURL(`worker/${type}-worker.html`, {
			init: {
				ins: { harvestTimeSeconds: 2 },
				harvest: { tooManyRequestsDelay: 10 }
			},
      workerCommands: [`newrelic.addPageAction("exampleEvent", {param: "value"})`]
    });

		router.scheduleResponse('ins', 429);

		let loadPromise = browser.get(assetURL);
		let insPromise = router.expectIns();
		let firstBody;
	
		Promise.all([loadPromise, insPromise])
		.then(( [, insResult] ) => {
			t.equal(insResult.res.statusCode, 429, 'server responded with 429')
			firstBody = JSON.parse(insResult.body)

			return router.expectIns()
		})
		.then((insResult) => {
			const secondBody = JSON.parse(insResult.body)

			t.equal(insResult.res.statusCode, 200, 'server responded with 200')
			t.deepEqual(secondBody, firstBody, 'post body in retry harvest should be the same as in the first harvest')
			t.equal(router.seenRequests.ins, 2, 'got two ins harvest requests')

			t.end()
		}).catch(fail(t));
	});
}

function paPrecedence (type, supportRegOrESMWorker) {
	testDriver.test(`${type} - addPageAction has precedence over custom attributes`, supportRegOrESMWorker, function (t, browser, router) {
		let assetURL = router.assetURL(`worker/${type}-worker.html`, {
			init: {
				ins: { harvestTimeSeconds: 5 }
			},
      workerCommands: [
				`newrelic.setCustomAttribute("browserHeight", 705)`,
				`newrelic.addPageAction("MyEvent", { referrerUrl: "http://test.com", browserHeight: 777, foo: {bar: "baz"} })`
			]
    });

		let loadPromise = browser.get(assetURL);
		let insPromise = router.expectIns();
	
		Promise.all([loadPromise, insPromise])
		.then(( [, {body}] ) => {
			precValidatePageActionData(JSON.parse(body).ins)
      t.end()
		}).catch(fail(t));

		function precValidatePageActionData (pageActionData) {
			t.equal(pageActionData.length, 1, 'should have 1 event')
	
			let event = pageActionData[0]
			t.equal(event.actionName, 'MyEvent', 'event has correct action name')
			t.equal(event.eventType, 'PageAction', 'defaults has correct precedence')
			t.equal(event.browserHeight, 777, 'att has correct precedence')
			t.equal(event.referrerUrl, 'http://test.com', 'attributes has correct precedence')
			t.equal(event.foo, '{"bar":"baz"}', 'custom member of attributes passed through')
		}
	});
}