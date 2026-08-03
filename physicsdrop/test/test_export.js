/**
 * Tests for export.js.
 *
 * Only the path logic is testable headlessly — the frame loop needs a document. That is fine,
 * because the path logic is where the interesting decision lives: `/fs` is denied in the sandbox,
 * so the output folder cannot be created and the exporter has to degrade to writing flat rather
 * than failing outright, the way v1.1 would.
 */

'use strict';

module.exports = function (PD, h) {

  h.group('export: timestamp');

  var s = PD.exportStamp();
  h.assert('the stamp is YYYYMMDD_HHMMSS', /^\d{8}_\d{6}$/.test(s), s);
  h.assert('and is zero padded to a fixed width', s.length === 15, s + ' (' + s.length + ')');

  h.group('export: where files go');

  // `require('/fs')` throws outside Affinity, so this exercises the no-folder path. There is
  // deliberately NO fallback to writing flat: the Desktop root is refused by doc.export, so a
  // fallback there would only turn a clear failure into a confusing later one.
  var mockApp = { userDesktopPath: 'E:\\USER\\Desktop' };
  var noFs = PD.exportResolveTarget(mockApp, 'png');

  h.assert('no folder means a reported failure, not a fallback', !!noFs.error, JSON.stringify(noFs));
  h.assert('and the failure names the folder it wanted',
    noFs.error.indexOf('PhysicsDrop_') >= 0, noFs.error);

  // Separators decide everything: a backslash-joined path is PERMISSION_DENIED from every /fs call
  // and from doc.export, while the backslash root with forward slashes appended works.
  h.assert('the intended folder uses forward slashes',
    /E:\\USER\\Desktop\/PhysicsDrop_/.test(noFs.error), noFs.error);
  h.assert('and appends no backslash of its own',
    noFs.error.indexOf('Desktop\\PhysicsDrop') < 0, noFs.error);

  h.group('export: frame naming');

  // The folder path is only reachable inside Affinity, so the naming rule is checked directly.
  // Frame numbers must zero-pad or an image sequence sorts 1, 10, 11, 2 and imports scrambled.
  var name = PD.exportFrameName(7, 'png');
  h.assertEqual('a frame name is zero padded to four digits', name, 'drop_0007.png');
  h.assertEqual('and stays padded past nine', PD.exportFrameName(42, 'png'), 'drop_0042.png');
  h.assertEqual('and does not overflow at four digits', PD.exportFrameName(1234, 'png'), 'drop_1234.png');
  h.assertEqual('jpeg gets the jpg extension', PD.exportFrameName(0, 'jpg'), 'drop_0000.jpg');

  h.group('export: failure reporting');

  h.assert('no Desktop path is reported rather than thrown',
    !!PD.exportResolveTarget({}, 'png').error);
  h.assert('an app that throws is reported too',
    !!PD.exportResolveTarget({ get userDesktopPath() { throw new Error('denied'); } }, 'png').error);

  // A missing SDK must call back with a failure, not throw: the export runs on a timer, and an
  // exception there would leave the timer wedged.
  var reported = null;
  PD.exportSequence({ doc: null, lastIndex: 3 }, {}, function (res) { reported = res; });
  h.assert('a missing SDK calls back', reported !== null);
  h.assertEqual('with a failure', reported.ok, false);
  h.assert('and an explanation', typeof reported.error === 'string' && reported.error.length > 0,
    String(reported && reported.error));
};
